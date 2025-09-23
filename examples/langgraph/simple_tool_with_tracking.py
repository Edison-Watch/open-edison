"""
LangGraph simple tool example, updated to include Edison tracking.

Run directly:
  OPEN_EDISON_API_KEY=dev-api-key-change-me OPEN_EDISON_API_BASE=http://localhost:3001 \
  uv run python examples/langgraph/simple_tool_with_tracking.py

If LangGraph/OpenAI packages or keys are not available, this script falls back
to directly calling the tracked tool (still exercises Edison tracking).

Note: If a call is blocked by policy, approve it in the Open Edison dashboard
and re-run the script.
"""

import os

from dotenv import load_dotenv

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]

# Load .env for OPENAI_API_KEY / OPEN_EDISON_* variables
load_dotenv()


def _get_api_base() -> str:
    return (os.getenv("OPEN_EDISON_API_BASE") or "http://localhost:3001").rstrip("/")


def _get_api_key() -> str | None:
    return os.getenv("OPEN_EDISON_API_KEY")


def run_bind_tools_variant() -> None:
    """Try to run the LangGraph bind_tools example with tracking.

    This requires langchain_openai + langgraph installed and provider API keys set.
    """
    from langchain_core.tools import tool  # type: ignore[reportMissingTypeStubs]
    from langchain_openai import ChatOpenAI  # type: ignore[reportMissingTypeStubs]

    edison = Edison(
        api_base=_get_api_base(),
        api_key=_get_api_key(),
        permissions_path=os.path.join(os.path.dirname(__file__), "tool_permissions.json"),
    )

    with edison.session():

        @tool  # type: ignore[misc]
        @edison.track()  # type: ignore[misc]
        def multiply(a: int, b: int) -> int:
            """Multiply two numbers."""
            return a * b

        model_name = os.getenv("OPENAI_MODEL") or "gpt-4o-mini"
        llm = ChatOpenAI(model=model_name)  # type: ignore[reportUnknownVariableType]
        llm_with_tools = edison.bind_tools(llm, [multiply])

        try:
            resp = llm_with_tools.invoke([("user", "Use multiply to compute 6 * 7")])
            print("bind_tools variant output:", resp)
        except PermissionError:
            print("multiply blocked by policy. Approve via the Open Edison dashboard, then rerun.")
            return


def main() -> None:
    run_bind_tools_variant()


if __name__ == "__main__":
    main()
