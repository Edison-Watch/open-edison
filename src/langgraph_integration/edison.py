import inspect
import json
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any

import httpx
from loguru import logger as log

from src.langgraph_integration import worker

_session_ctx: ContextVar[str | None] = ContextVar("edison_session_id")


class Edison:
    def __init__(
        self,
        api_base: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 30.0,
        permissions_path: str | None = None,
        healthcheck: bool = True,
        healthcheck_timeout_s: float = 3.0,
    ):
        # Management API base (FastAPI), not MCP. Default to localhost:3001
        base = api_base or "http://localhost:3001"
        self.api_base: str = base.rstrip("/")
        self.api_key: str | None = api_key
        self.timeout_s: float = timeout_s
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        # Start background worker for end events
        worker.start(self.api_base, headers)
        # Best-effort healthchecks
        if healthcheck:
            try:
                self._healthcheck(healthcheck_timeout_s)
            except Exception as e:  # noqa: BLE001
                log.debug(f"Edison healthcheck raised: {e}")

    @contextmanager
    def session(self, session_id: str | None = None):
        """Set the session context. Auto-mint UUIDv4 if None."""
        sid = session_id or str(uuid.uuid4())
        token = _session_ctx.set(sid)
        try:
            yield sid
        finally:
            _session_ctx.reset(token)

    def _resolve_session_id(self, override: str | None) -> str:
        if override:
            return override
        current = _session_ctx.get(None)
        if current:
            return current
        # Auto-mint and set contextvar for continuity
        sid = str(uuid.uuid4())
        _session_ctx.set(sid)
        return sid

    def _http_headers(self) -> dict[str, str] | None:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None

    def _healthcheck(self, timeout_s: float) -> None:
        """Best-effort checks: reachability and API key validity.

        - GET /health (no auth)
        - GET /mcp/status (auth) when api_key is provided
        Logs errors but does not raise.
        """
        try:
            resp = httpx.get(f"{self.api_base}/health", timeout=timeout_s)
            if resp.status_code >= 400:
                log.error(
                    f"Open Edison management API unreachable or unhealthy at {self.api_base} (/health HTTP {resp.status_code})"
                )
            else:
                log.debug("Edison /health OK")
        except Exception as e:  # noqa: BLE001
            log.error(f"Failed to reach Open Edison at {self.api_base}/health: {e}")

        # Validate API key if present
        if self.api_key:
            try:
                r2 = httpx.get(
                    f"{self.api_base}/mcp/status",
                    headers=self._http_headers(),
                    timeout=timeout_s,
                )
                if r2.status_code == 401:
                    log.error("Open Edison API key invalid (401 on /mcp/status)")
                elif r2.status_code >= 400:
                    log.error(
                        f"Open Edison /mcp/status returned HTTP {r2.status_code}: {r2.text[:200]}"
                    )
                else:
                    log.debug("Edison /mcp/status OK (auth)")
            except Exception as e:  # noqa: BLE001
                log.error(f"Failed to call /mcp/status: {e}")

    @staticmethod
    def _normalize_agent_name(raw: str | None) -> str:
        base = raw or "tracked"
        return base if base.startswith("agent_") else f"agent_{base}"

    def track(
        self, session_id: str | None = None, name: str | None = None
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to track arbitrary functions with OE parity (gating + approvals + logging).

        - session id resolution: kwarg __edison_session_id -> decorator arg -> contextvar -> auto-mint
        - name resolution: provided name or function.__name__
        - pre-call: /agent/begin (await approval)
        - post-call: /agent/end (queued via background worker)
        """

        def _decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            fname = self._normalize_agent_name(name or getattr(func, "__name__", "tracked"))

            if inspect.iscoroutinefunction(func):

                @wraps(func)
                async def _aw(*args: Any, **kwargs: Any) -> Any:
                    sid = self._resolve_session_id(
                        kwargs.pop("__edison_session_id", None) or session_id
                    )
                    begin = {
                        "session_id": sid,
                        "name": fname,
                        "args_summary": self._build_args_preview(args, kwargs),
                        "timeout_s": self.timeout_s,
                    }
                    call_id = await self._begin(begin)
                    start = time.perf_counter()
                    try:
                        result = await func(*args, **kwargs)
                        duration = (time.perf_counter() - start) * 1000.0
                        worker.enqueue_end(
                            {
                                "session_id": sid,
                                "call_id": call_id,
                                "status": "ok",
                                "duration_ms": duration,
                                "result_summary": self._build_result_preview(result),
                            }
                        )
                        return result
                    except Exception as e:  # noqa: BLE001
                        duration = (time.perf_counter() - start) * 1000.0
                        worker.enqueue_end(
                            {
                                "session_id": sid,
                                "call_id": call_id,
                                "status": "error",
                                "duration_ms": duration,
                                "result_summary": str(e),
                            }
                        )
                        raise

                return _aw

            @wraps(func)
            def _sw(*args: Any, **kwargs: Any) -> Any:
                sid = self._resolve_session_id(
                    kwargs.pop("__edison_session_id", None) or session_id
                )
                begin = {
                    "session_id": sid,
                    "name": fname,
                    "args_summary": self._build_args_preview(args, kwargs),
                    "timeout_s": self.timeout_s,
                }
                call_id = self._begin_sync(begin)
                start = time.perf_counter()
                try:
                    result = func(*args, **kwargs)
                    duration = (time.perf_counter() - start) * 1000.0
                    worker.enqueue_end(
                        {
                            "session_id": sid,
                            "call_id": call_id,
                            "status": "ok",
                            "duration_ms": duration,
                            "result_summary": self._build_result_preview(result),
                        }
                    )
                    return result
                except Exception as e:  # noqa: BLE001
                    duration = (time.perf_counter() - start) * 1000.0
                    worker.enqueue_end(
                        {
                            "session_id": sid,
                            "call_id": call_id,
                            "status": "error",
                            "duration_ms": duration,
                            "result_summary": str(e),
                        }
                    )
                    raise

            return _sw

        return _decorator

    def wrap_tools(self, tools: list[Any]) -> list[Any]:
        """Return wrapped callables/tools.

        For plain callables, return tracked callables. For objects with a callable interface,
        try to wrap their .invoke or __call__ while preserving original object reference.
        """
        wrapped: list[Any] = []
        for t in tools:
            try:
                # Plain callables (not LangChain tools)
                if callable(t) and not hasattr(t, "invoke"):
                    wrapped.append(self.track()(t))
                    continue

                # Runnable tools (LangChain BaseTool/StructuredTool et al.)
                try:
                    invoke = t.invoke  # type: ignore[attr-defined]
                except Exception:
                    wrapped.append(t)
                    continue
                if callable(invoke):
                    try:
                        # Some tool types (e.g., pydantic models) are immutable; fall back if assignment fails
                        t.invoke = self.track()(invoke)  # type: ignore[attr-defined]
                        wrapped.append(t)
                    except Exception:
                        wrapped.append(t)
                else:
                    wrapped.append(t)
            except Exception:
                wrapped.append(t)
        return wrapped

    def bind_tools(self, llm: Any, tools: list[Any]) -> Any:
        """Wrap tools then call llm.bind_tools(tools)."""
        wrapped = self.wrap_tools(tools)
        binder = getattr(llm, "bind_tools", None)
        if binder is None:
            raise AttributeError("llm does not support bind_tools")
        return binder(wrapped)

    async def _begin(self, payload: dict[str, Any]) -> str:
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            resp = await client.post(
                f"{self.api_base}/agent/begin", json=payload, headers=self._http_headers()
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"/agent/begin failed: {resp.status_code} {resp.text}")
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error") or "begin failed")
        if data.get("approved") is False:
            raise PermissionError(data.get("error") or "blocked by policy")
        return str(data.get("call_id"))

    def _begin_sync(self, payload: dict[str, Any]) -> str:
        resp = httpx.post(
            f"{self.api_base}/agent/begin",
            json=payload,
            headers=self._http_headers(),
            timeout=self.timeout_s,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"/agent/begin failed: {resp.status_code} {resp.text}")
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error") or "begin failed")
        if data.get("approved") is False:
            raise PermissionError(data.get("error") or "blocked by policy")
        return str(data.get("call_id"))

    def _build_args_preview(self, args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
        """Serialize args/kwargs to a JSON-ish string capped at 1,000,000 chars.

        We prefer JSON for readability; fallback to repr on failures.
        """
        max_len = 1_000_000
        payload: Any = {"args": list(args), "kwargs": kwargs} if kwargs else list(args)
        try:
            s = json.dumps(payload, default=self._json_fallback)
        except Exception:
            try:
                s = f"args={args!r}, kwargs={kwargs!r}"
            except Exception:
                s = "<unserializable>"
        if len(s) > max_len:
            return s[:max_len]
        return s

    def _build_result_preview(self, result: Any) -> str:
        """Serialize result to a string capped at 1,000,000 chars."""
        max_len = 1_000_000
        try:
            s = json.dumps(result, default=self._json_fallback)
        except Exception:
            try:
                s = str(result)
            except Exception:
                s = "<unserializable>"
        if len(s) > max_len:
            return s[:max_len]
        return s

    @staticmethod
    def _json_fallback(obj: Any) -> str:
        try:
            return str(obj)
        except Exception:
            return "<unserializable>"
