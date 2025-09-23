import inspect
import json
import os
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from contextvars import ContextVar
from functools import wraps
from threading import Thread
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
        healthcheck: bool = True,
        healthcheck_timeout_s: float = 3.0,
    ):
        # Management API base (FastAPI), not MCP. Default to localhost:3001
        base = api_base or os.getenv("OPEN_EDISON_API_BASE", "http://localhost:3001")
        self.api_base: str = base.rstrip("/")
        self.api_key: str | None = api_key or os.getenv(
            "OPEN_EDISON_API_KEY", "dev-api-key-change-me"
        )
        self.timeout_s: float = timeout_s
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        # Start background worker for end events
        worker.start(self.api_base, headers)
        # Best-effort healthchecks (background)
        if healthcheck:
            Thread(target=self._healthcheck, args=(healthcheck_timeout_s,), daemon=True).start()

    @classmethod
    def get_session_id(cls) -> str:
        current = _session_ctx.get(None)
        if current:
            return current
        sid = str(uuid.uuid4())
        _session_ctx.set(sid)
        return sid

    @classmethod  # noqa
    def set_session_id(cls, session_id: str) -> str:
        """Set the ContextVar for the current context."""
        _session_ctx.set(session_id)
        return session_id

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
            if resp.status_code < 400:
                log.debug("Edison /health OK")
            else:
                log.error(f"/health HTTP {resp.status_code}")
        except Exception as e:  # noqa: BLE001
            log.error(f"/health error: {e}")

        if not self.api_key:
            log.warning("Edison /mcp/status skipped (no API key)")
        try:
            r2 = httpx.get(
                f"{self.api_base}/mcp/status",
                headers=self._http_headers(),
                timeout=timeout_s,
            )
            if r2.status_code == 401:
                log.error("/mcp/status 401 (invalid API key)")
            elif r2.status_code >= 400:
                log.error(f"/mcp/status HTTP {r2.status_code}")
            else:
                log.debug("Edison /mcp/status OK (auth)")
        except Exception:  # noqa: BLE001
            log.exception("/mcp/status error")

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
            # Bind a stable session id at decoration time (shared across tools created in the same context)
            bound_sid = session_id or Edison.get_session_id()

            if inspect.iscoroutinefunction(func):

                @wraps(func)
                async def _aw(*args: Any, **kwargs: Any) -> Any:
                    sid_override = kwargs.pop("__edison_session_id", None)
                    sid = sid_override or bound_sid
                    log.debug(f"Edison.track begin (async): name={fname} sid={sid}")
                    begin = {
                        "session_id": sid,
                        "name": fname,
                        "args_summary": self._build_args_preview(args, kwargs),
                        "timeout_s": self.timeout_s,
                    }
                    call_id = await self._begin(begin)

                    def _send_end(status: str, duration_ms: float, summary: str) -> None:
                        worker.enqueue_end(
                            {
                                "session_id": sid,
                                "call_id": call_id,
                                "status": status,
                                "duration_ms": duration_ms,
                                "result_summary": summary,
                            }
                        )

                    start = time.perf_counter()
                    try:
                        result = await func(*args, **kwargs)
                        duration = (time.perf_counter() - start) * 1000.0
                        _send_end("ok", duration, self._build_result_preview(result))
                        log.debug(
                            f"Edison.track end (async ok): name={fname} sid={sid} dur_ms={duration:.1f}"
                        )
                        return result
                    except Exception as e:  # noqa: BLE001
                        duration = (time.perf_counter() - start) * 1000.0
                        _send_end("error", duration, str(e))
                        log.debug(
                            f"Edison.track end (async error): name={fname} sid={sid} dur_ms={duration:.1f} err={e}"
                        )
                        raise

                return _aw

            @wraps(func)
            def _sw(*args: Any, **kwargs: Any) -> Any:
                sid_override = kwargs.pop("__edison_session_id", None)
                sid = sid_override or bound_sid
                log.debug(f"Edison.track begin (sync): name={fname} sid={sid}")
                begin = {
                    "session_id": sid,
                    "name": fname,
                    "args_summary": self._build_args_preview(args, kwargs),
                    "timeout_s": self.timeout_s,
                }
                call_id = self._begin_sync(begin)

                def _send_end(status: str, duration_ms: float, summary: str) -> None:
                    worker.enqueue_end(
                        {
                            "session_id": sid,
                            "call_id": call_id,
                            "status": status,
                            "duration_ms": duration_ms,
                            "result_summary": summary,
                        }
                    )

                start = time.perf_counter()
                try:
                    result = func(*args, **kwargs)
                    duration = (time.perf_counter() - start) * 1000.0
                    _send_end("ok", duration, self._build_result_preview(result))
                    log.debug(
                        f"Edison.track end (sync ok): name={fname} sid={sid} dur_ms={duration:.1f}"
                    )
                    return result
                except Exception as e:  # noqa: BLE001
                    duration = (time.perf_counter() - start) * 1000.0
                    _send_end("error", duration, str(e))
                    log.debug(
                        f"Edison.track end (sync error): name={fname} sid={sid} dur_ms={duration:.1f} err={e}"
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
            # Plain callables (not LangChain tools)
            if callable(t) and not hasattr(t, "invoke"):
                wrapped.append(self.track()(t))
                continue

            # Runnable tools (LangChain BaseTool/StructuredTool et al.)
            invoke = getattr(t, "invoke", None)
            if callable(invoke):
                with suppress(Exception):
                    t.invoke = self.track()(invoke)  # type: ignore[attr-defined]
                wrapped.append(t)
            else:
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
