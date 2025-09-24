"""Minimal LangGraph agent example."""

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from src.langgraph_integration import Edison

edison = Edison()


@tool
@edison.track()  # auto-names: agent_web_search
def web_search(query: str, _max_results: int = 3) -> str:
    """Return up to N result URLs (demo)."""
    return "https://docs.python.org/3/"


@tool
@edison.track()  # auto-names: agent_fetch_url
def fetch_url(url: str, _max_chars: int = 1000) -> str:
    """Return a fake preview for demonstration; no network call."""
    return f"FAKE PREVIEW for {url} (first {_max_chars} chars)"


llm = ChatOpenAI()
agent = create_react_agent(model=llm, tools=[web_search, fetch_url])


if __name__ == "__main__":
    result = agent.invoke(
        {"messages": [("user", "Fetch the first 1000 chars of the CPython docs homepage.")]}
    )
    print(result["messages"][-1].content)
