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

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]


def _get_api_base() -> str:
    val = os.getenv("OPEN_EDISON_API_BASE") or "http://localhost:3001"
    return val.rstrip("/")


def _get_api_key() -> str | None:
    return os.getenv("OPEN_EDISON_API_KEY")


def main() -> None:
    edison = Edison(
        api_base=_get_api_base(),
        api_key=_get_api_key(),
        permissions_path=os.path.join(os.path.dirname(__file__), "tool_permissions.json"),
    )

    with edison.session():

        @edison.track()
        def cleanse_text(text: str) -> str:
            return text.strip()

        # First call may block by policy; approve in dashboard if needed
        try:
            out = cleanse_text("  hello  ")
        except PermissionError:
            print(
                "cleanse_text blocked by policy. Approve via the Open Edison dashboard, then rerun."
            )
            return

        assert out == "hello", f"Unexpected cleanse_text result: {out!r}"

        # Async tracked function demo
        @edison.track()
        async def add(a: int, b: int) -> int:
            return a + b

        # If blocked, approve in dashboard then rerun
        try:
            # In a real LangGraph node you'd await within the graph runtime
            import asyncio

            out2 = asyncio.run(add(2, 3))  # noqa: SLF001 - simple demo
        except PermissionError:
            print("add blocked by policy. Approve via the Open Edison dashboard, then rerun.")
            return

        assert out2 == 5, f"Unexpected add result: {out2!r}"

    print("OK - example agent ran with tracking, approvals, and assertions.")


if __name__ == "__main__":
    main()
