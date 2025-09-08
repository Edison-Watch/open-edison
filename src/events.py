"""
Lightweight in-process event broadcasting for Open Edison (SSE-friendly).

Provides a simple publisher/subscriber model to stream JSON events to
connected dashboard clients over Server-Sent Events (SSE).
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from functools import wraps
from typing import Any

from loguru import logger as log

_subscribers: set[asyncio.Queue[str]] = set()
_lock = asyncio.Lock()

# One-time approvals for (session_id, kind, name)
_approvals: dict[str, asyncio.Event] = {}
_approvals_lock = asyncio.Lock()


def _approval_key(session_id: str, kind: str, name: str) -> str:
    return f"{session_id}::{kind}::{name}"


def requires_loop(func: Callable[..., Any]) -> Callable[..., None | Any]:  # noqa: ANN401
    """Decorator to ensure the function is called when there is a running asyncio loop.
    This is for sync(!) functions that return None / can do so on error"""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> None | Any:
        try:
            # get_running_loop() raises RuntimeError if no loop is running in this thread
            _ = asyncio.get_running_loop()
        except RuntimeError:
            log.warning("fire_and_forget called in non-async context")
            return None
        return func(*args, **kwargs)

    return wrapper


async def subscribe() -> asyncio.Queue[str]:
    """Register a new subscriber and return its queue of SSE strings."""
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
    async with _lock:
        _subscribers.add(queue)
        log.debug(f"SSE subscriber added (total={len(_subscribers)})")
    return queue


async def unsubscribe(queue: asyncio.Queue[str]) -> None:
    """Remove a subscriber and drain its queue."""
    async with _lock:
        _subscribers.discard(queue)
        log.debug(f"SSE subscriber removed (total={len(_subscribers)})")
    try:
        while not queue.empty():
            _ = queue.get_nowait()
    except Exception:
        pass


async def publish(event: dict[str, Any]) -> None:
    """Publish a JSON event to all subscribers.

    The event is serialized and wrapped as an SSE data frame.
    """
    try:
        data = json.dumps(event, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        log.error(f"Failed to serialize event for SSE: {e}")
        return

    frame = f"data: {data}\n\n"
    async with _lock:
        dead: list[asyncio.Queue[str]] = []
        for q in _subscribers:
            try:
                # Best-effort non-blocking put; drop if full to avoid backpressure
                if q.full():
                    _ = q.get_nowait()
                q.put_nowait(frame)
            except Exception:
                dead.append(q)
        for q in dead:
            _subscribers.discard(q)


@requires_loop
def fire_and_forget(event: dict[str, Any]) -> None:
    """Schedule publish(event) and log any exception when the task completes."""
    task = asyncio.create_task(publish(event))

    def _log_exc(t: asyncio.Task[None]) -> None:
        try:
            _ = t.exception()
            if _ is not None:
                log.error(f"SSE publish failed: {_}")
        except Exception as e:  # noqa: BLE001
            log.error(f"SSE publish done-callback error: {e}")

    task.add_done_callback(_log_exc)


async def approve_once(session_id: str, kind: str, name: str) -> None:
    """Approve a single pending operation for this session/kind/name.

    This unblocks exactly one waiter if present (and future waiters will create a new Event).
    """
    key = _approval_key(session_id, kind, name)
    async with _approvals_lock:
        ev = _approvals.get(key)
        if ev is None:
            ev = asyncio.Event()
            _approvals[key] = ev
        ev.set()


async def wait_for_approval(session_id: str, kind: str, name: str, timeout_s: float = 30.0) -> bool:
    """Wait up to timeout for approval. Consumes the approval if granted."""
    key = _approval_key(session_id, kind, name)
    async with _approvals_lock:
        ev = _approvals.get(key)
        if ev is None:
            ev = asyncio.Event()
            _approvals[key] = ev
    try:
        await asyncio.wait_for(ev.wait(), timeout=timeout_s)
        return True
    except TimeoutError:
        return False
    finally:
        # Consume the event so it does not auto-approve future waits
        async with _approvals_lock:
            _approvals.pop(key, None)


async def sse_stream(queue: asyncio.Queue[str]) -> AsyncIterator[bytes]:
    """Yield SSE frames from the given queue with periodic heartbeats."""
    try:
        # Initial comment to open the stream
        yield b": connected\n\n"
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield frame.encode("utf-8")
            except TimeoutError:
                # Heartbeat to keep the connection alive
                yield b": ping\n\n"
    finally:
        await unsubscribe(queue)
