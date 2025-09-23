import threading
import time
from contextlib import suppress
from queue import Empty, Queue
from typing import Any

import httpx
from loguru import logger as log

_queue: Queue[dict[str, Any]] | None = None
_worker_thread: threading.Thread | None = None
_stop_flag = threading.Event()
_api_base: str = ""
_headers: dict[str, str] | None = None


def start(api_base: str, headers: dict[str, str] | None) -> None:
    global _queue, _worker_thread, _api_base, _headers
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _queue = Queue(maxsize=1000)
    _api_base = api_base.rstrip("/")
    _headers = headers
    _stop_flag.clear()
    _worker_thread = threading.Thread(target=_run, name="edison-tracking-worker", daemon=True)
    _worker_thread.start()


def stop() -> None:
    _stop_flag.set()


def enqueue_end(payload: dict[str, Any]) -> None:
    if _queue is None:
        log.warning("enqueue_end called before worker start; dropping payload")
        return
    try:
        _queue.put_nowait(payload)
    except Exception as e:
        log.error(f"Failed to enqueue end payload: {e}")


def _run() -> None:
    assert _queue is not None
    backoff_s = 0.5
    client = httpx.Client(timeout=10.0)
    while not _stop_flag.is_set():
        try:
            item = _queue.get(timeout=0.5)
        except Empty:
            continue

        try:
            resp = client.post(f"{_api_base}/agent/end", json=item, headers=_headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
            backoff_s = 0.5
        except Exception as e:  # noqa: BLE001
            log.warning(f"/track/end failed, will retry: {e}")
            # basic retry: requeue and sleep w/ backoff
            with suppress(Exception):
                _queue.put(item)
            time.sleep(backoff_s)
            backoff_s = min(backoff_s * 2.0, 10.0)
