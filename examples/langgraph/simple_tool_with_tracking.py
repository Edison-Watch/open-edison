"""
LangGraph simple tool example, updated to include Edison tracking.

Run directly:
  OPEN_EDISON_API_KEY=dev-api-key-change-me OPEN_EDISON_API_BASE=http://localhost:3001 \
  uv run python examples/langgraph/simple_tool_with_tracking.py

If LangGraph/OpenAI packages or keys are not available, this script falls back
to directly calling the tracked tool (still exercises Edison tracking/approvals).
"""

import os

import httpx

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]


def _get_api_base() -> str:
    return (os.getenv("OPEN_EDISON_API_BASE") or "http://localhost:3001").rstrip("/")


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


def run_bind_tools_variant() -> None:
    """Try to run the LangGraph bind_tools example with tracking.

    This requires langchain_openai + langgraph installed and provider API keys set.
    """
    from langchain_core.tools import tool  # type: ignore[reportMissingTypeStubs]
    from langchain_openai import ChatOpenAI  # type: ignore[reportMissingTypeStubs]

    edison = Edison(api_base=_get_api_base(), api_key=_get_api_key())

    with edison.session() as sid:

        @tool  # type: ignore[misc]
        @edison.track()  # type: ignore[misc]
        def multiply(a: int, b: int) -> int:
            """Multiply two numbers."""
            return a * b

        llm = ChatOpenAI()  # type: ignore[reportUnknownVariableType]
        llm_with_tools = edison.bind_tools(llm, [multiply])

        try:
            resp = llm_with_tools.invoke([("user", "Use multiply to compute 6 * 7")])
        except PermissionError:
            _approve_once(sid, "client.multiply")
            resp = llm_with_tools.invoke([("user", "Use multiply to compute 6 * 7")])

        print("bind_tools variant output:", resp)


def run_direct_fallback() -> None:
    """Fallback that doesn't require LangGraph/OpenAI; still exercises tracking."""
    edison = Edison(api_base=_get_api_base(), api_key=_get_api_key())

    with edison.session() as sid:

        @edison.track()
        def multiply(a: int, b: int) -> int:
            return a * b

        try:
            out = multiply(6, 7)
        except PermissionError:
            _approve_once(sid, "client.multiply")
            out = multiply(6, 7)

        assert out == 42, f"Unexpected result: {out!r}"
        print("direct fallback output:", out)


def main() -> None:
    # Prefer running the full LangGraph example if packages are available and keys are set
    want_graph = os.getenv("RUN_LANGGRAPH", "0")
    if want_graph == "1":
        try:
            run_bind_tools_variant()
            return
        except Exception as e:  # noqa: BLE001
            print("LangGraph variant failed, falling back to direct call:", e)
    run_direct_fallback()


if __name__ == "__main__":
    main()
