import inspect
import json
import os
import time
import traceback
import uuid
from collections.abc import Callable
from contextlib import suppress
from contextvars import ContextVar
from functools import wraps
from threading import Thread
from typing import Any

import httpx
from loguru import logger as log

_session_ctx: ContextVar[str | None] = ContextVar("edison_session_id")


class Edison:
    def __init__(
        self,
        api_base: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 30.0,
        healthcheck: bool = True,
        healthcheck_timeout_s: float = 3.0,
        agent_name: str | None = None,
        agent_type: str | None = None,
        session_id: str | None = None,
    ):
        # Management API base (FastAPI), not MCP. Default to localhost:3001
        base = api_base or os.getenv("OPEN_EDISON_API_BASE", "http://localhost:3001")
        self.api_base: str = base.rstrip("/")
        self.api_key: str | None = api_key or os.getenv(
            "OPEN_EDISON_API_KEY", "dev-api-key-change-me"
        )
        self.timeout_s: float = timeout_s
        self.agent_name: str | None = agent_name
        self.agent_type: str | None = agent_type
        # Bind to a specific session ID, or generate one per instance
        self.session_id: str = session_id or str(uuid.uuid4())
        # Headers are added per-request via _http_headers()
        # Best-effort healthchecks (background)
        if healthcheck:
            Thread(target=self._healthcheck, args=(healthcheck_timeout_s,), daemon=True).start()

    @classmethod  # noqa
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

    def track(  # noqa: C901
        self,
        session_id: str | None = None,
        name: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to gate and log tool calls via the OE server.

        Flow per call:
        - Resolve session id
        - POST /agent/begin (gating/approval)
        - Execute function
        - POST /agent/end (status, duration, result summary)

        Args:
            session_id: Fixed session ID for all calls
            name: Tool name override
        """

        def _decorator(func: Callable[..., Any]) -> Callable[..., Any]:  # noqa: C901
            tool_name = self._normalize_agent_name(name or getattr(func, "__name__", "tracked"))
            # Use provided session_id, instance session_id, or contextvar
            bound_sid = session_id or self.session_id
            # Use instance-level agent identity
            agent_name = self.agent_name
            agent_type = self.agent_type

            async def _end_async(
                sid: str, call_id: str, status: str, duration_ms: float, summary: str
            ) -> None:
                try:
                    async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                        await client.post(
                            f"{self.api_base}/agent/end",
                            json={
                                "session_id": sid,
                                "call_id": call_id,
                                "status": status,
                                "duration_ms": duration_ms,
                                "result_summary": summary,
                            },
                            headers=self._http_headers(),
                        )
                except Exception:
                    log.exception("Edison.track /agent/end async failed.")

            def _end_sync(
                sid: str, call_id: str, status: str, duration_ms: float, summary: str
            ) -> None:
                try:
                    httpx.post(
                        f"{self.api_base}/agent/end",
                        json={
                            "session_id": sid,
                            "call_id": call_id,
                            "status": status,
                            "duration_ms": duration_ms,
                            "result_summary": summary,
                        },
                        headers=self._http_headers(),
                        timeout=self.timeout_s,
                    )
                except Exception:  # noqa: BLE001
                    log.exception("Edison.track /agent/end sync failed.")

            if inspect.iscoroutinefunction(func):

                @wraps(func)
                async def _aw(*args: Any, **kwargs: Any) -> Any:
                    sid = kwargs.pop("__edison_session_id", None) or bound_sid
                    payload = {
                        "session_id": sid,
                        "name": tool_name,
                        "args_summary": self._build_args_preview(args, kwargs),
                        "timeout_s": self.timeout_s,
                    }
                    if agent_name:
                        payload["agent_name"] = agent_name
                    if agent_type:
                        payload["agent_type"] = agent_type
                    call_id = await self._begin(payload)
                    start = time.perf_counter()
                    try:
                        result = await func(*args, **kwargs)
                        duration = (time.perf_counter() - start) * 1000.0
                        await _end_async(
                            sid, call_id, "ok", duration, self._build_result_preview(result)
                        )
                        return result
                    except Exception:  # noqa: BLE001
                        duration = (time.perf_counter() - start) * 1000.0
                        await _end_async(sid, call_id, "error", duration, traceback.format_exc())
                        raise

                return _aw

            @wraps(func)
            def _sw(*args: Any, **kwargs: Any) -> Any:
                sid = kwargs.pop("__edison_session_id", None) or bound_sid
                payload = {
                    "session_id": sid,
                    "name": tool_name,
                    "args_summary": self._build_args_preview(args, kwargs),
                    "timeout_s": self.timeout_s,
                }
                if agent_name:
                    payload["agent_name"] = agent_name
                if agent_type:
                    payload["agent_type"] = agent_type
                call_id = self._begin_sync(payload)
                start = time.perf_counter()
                try:
                    result = func(*args, **kwargs)
                    duration = (time.perf_counter() - start) * 1000.0
                    _end_sync(sid, call_id, "ok", duration, self._build_result_preview(result))
                    return result
                except Exception:  # noqa: BLE001
                    duration = (time.perf_counter() - start) * 1000.0
                    _end_sync(sid, call_id, "error", duration, traceback.format_exc())
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
