"""
Minimal example agent demonstrating @Edison.track() and approval flow.

Run directly:
  python examples/langgraph/agent_sample.py

Requirements:
- Open Edison server running (make run)
- API key set in Config().server.api_key
- Environment: OPEN_EDISON_API_KEY (and optionally OPEN_EDISON_API_BASE=http://localhost:3001)
"""

import os

import httpx

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]


def _get_api_base() -> str:
    val = os.getenv("OPEN_EDISON_API_BASE") or "http://localhost:3001"
    return val.rstrip("/")


def _get_api_key() -> str | None:
    return os.getenv("OPEN_EDISON_API_KEY")


def _approve_once(session_id: str, tool_name: str) -> None:
    api_base = _get_api_base()
    api_key = _get_api_key()
    headers: dict[str, str] | None = {"Authorization": f"Bearer {api_key}"} if api_key else None
    body = {"session_id": session_id, "kind": "tool", "name": tool_name, "command": "approve"}
    resp = httpx.post(f"{api_base}/api/approve_or_deny", json=body, headers=headers, timeout=10.0)
    if resp.status_code >= 400:
        raise RuntimeError(f"Approval failed: {resp.status_code} {resp.text}")


def main() -> None:
    edison = Edison(api_base=_get_api_base(), api_key=_get_api_key())

    with edison.session() as sid:

        @edison.track()
        def cleanse_text(text: str) -> str:
            return text.strip()

        # First call may block by policy; approve once then retry
        try:
            out = cleanse_text("  hello  ")
        except PermissionError:
            # Approve this tool for this session and retry once
            _approve_once(sid, "client.cleanse_text")
            out = cleanse_text("  hello  ")

        assert out == "hello", f"Unexpected cleanse_text result: {out!r}"

        # Async tracked function demo
        @edison.track()
        async def add(a: int, b: int) -> int:
            return a + b

        # Approve if needed then run
        try:
            # In a real LangGraph node you'd await within the graph runtime
            import asyncio

            out2 = asyncio.run(add(2, 3))  # noqa: SLF001 - simple demo
        except PermissionError:
            _approve_once(sid, "client.add")
            import asyncio

            out2 = asyncio.run(add(2, 3))  # noqa: SLF001 - simple demo

        assert out2 == 5, f"Unexpected add result: {out2!r}"

    print("OK - example agent ran with tracking, approvals, and assertions.")


if __name__ == "__main__":
    main()
