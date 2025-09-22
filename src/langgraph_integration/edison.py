import inspect
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

import httpx

from src.langgraph_integration import worker
from src.langgraph_integration.redaction import summarize_args

_session_ctx: ContextVar[str | None] = ContextVar("edison_session_id")


class Edison:
    def __init__(
        self, api_base: str | None = None, api_key: str | None = None, timeout_s: float = 30.0
    ):
        # Management API base (FastAPI), not MCP. Default to localhost:3001
        base = api_base or "http://localhost:3001"
        self.api_base: str = base.rstrip("/")
        self.api_key: str | None = api_key
        self.timeout_s: float = timeout_s
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        # Start background worker for end events
        worker.start(self.api_base, headers)

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

    def track(
        self, session_id: str | None = None, name: str | None = None
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to track arbitrary functions with OE parity (gating + approvals + logging).

        - session id resolution: kwarg __edison_session_id -> decorator arg -> contextvar -> auto-mint
        - name resolution: provided name or function.__name__
        - pre-call: /track/begin (await approval)
        - post-call: /track/end (queued via background worker)
        """

        def _decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            fname = name or getattr(func, "__name__", "tracked")

            if inspect.iscoroutinefunction(func):

                async def _aw(*args: Any, **kwargs: Any) -> Any:
                    sid = self._resolve_session_id(
                        kwargs.pop("__edison_session_id", None) or session_id
                    )
                    begin = {
                        "session_id": sid,
                        "name": fname,
                        "args_summary": summarize_args(args, kwargs),
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

            def _sw(*args: Any, **kwargs: Any) -> Any:
                sid = self._resolve_session_id(
                    kwargs.pop("__edison_session_id", None) or session_id
                )
                begin = {
                    "session_id": sid,
                    "name": fname,
                    "args_summary": summarize_args(args, kwargs),
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
            if callable(t) and not hasattr(t, "invoke"):
                wrapped.append(self.track()(t))
            elif hasattr(t, "invoke") and callable(t.invoke):  # type: ignore[attr-defined]
                fn = t.invoke  # type: ignore[attr-defined]
                t.invoke = self.track()(fn)  # type: ignore[attr-defined]
                wrapped.append(t)
            else:
                # best-effort no-op
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
                f"{self.api_base}/track/begin", json=payload, headers=self._http_headers()
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"/track/begin failed: {resp.status_code} {resp.text}")
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error") or "begin failed")
        if data.get("approved") is False:
            raise PermissionError(data.get("error") or "blocked by policy")
        return str(data.get("call_id"))

    def _begin_sync(self, payload: dict[str, Any]) -> str:
        resp = httpx.post(
            f"{self.api_base}/track/begin",
            json=payload,
            headers=self._http_headers(),
            timeout=self.timeout_s,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"/track/begin failed: {resp.status_code} {resp.text}")
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error") or "begin failed")
        if data.get("approved") is False:
            raise PermissionError(data.get("error") or "blocked by policy")
        return str(data.get("call_id"))
