"""
ReAct multi-tool research agent example using Edison tracking.

Usage:
  OPENAI_API_KEY=... uv run python examples/langgraph/react_research_agent.py

Notes:
- Tools: web_search (DuckDuckGo HTML), fetch_url (HTTP GET, text only)
- Each tool is decorated with @edison.track() so calls are gated/logged via OE
- Requires the OE management API running on http://localhost:3001 (default)
"""

import os
import re
import urllib.parse

import httpx
from bs4 import BeautifulSoup  # type: ignore[reportMissingTypeStubs]
from dotenv import load_dotenv
from langgraph.config import get_stream_writer  # type: ignore[reportMissingTypeStubs]

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]

load_dotenv()


def _duckduckgo_search(query: str, max_results: int = 3) -> list[str]:
    writer = get_stream_writer()
    writer(f"[web_search] Searching: {query}")
    q = urllib.parse.quote_plus(query)
    url = f"https://duckduckgo.com/html/?q={q}"
    with httpx.Client(timeout=10.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
        resp = client.get(url)
    html = resp.text
    # Extract result URLs from DDG redirect links: href="/l/?uddg=<url-encoded>"
    urls: list[str] = []
    for m in re.finditer(r"href=\"/l/\?uddg=([^&\"]+)", html):
        try:
            enc = m.group(1)
            decoded = urllib.parse.unquote(enc)
            if decoded.startswith("http"):
                urls.append(decoded)
            if len(urls) >= max_results:
                break
        except Exception:
            continue
    if writer:
        writer(f"[web_search] Found {len(urls)} results")
    return urls


def _http_fetch(url: str, max_chars: int = 4000) -> str:
    writer = get_stream_writer()
    writer(f"[fetch_url] Fetching: {url}")
    with httpx.Client(timeout=15.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
        r = client.get(url, follow_redirects=True)
    # Prefer HTML-to-text when possible for readable terminal output
    body = r.text or ""
    try:
        soup = BeautifulSoup(body, "html.parser")
        # Remove script/style
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        # Collapse excessive whitespace
        text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    except Exception:
        text = body
    if writer:
        writer(
            f"[fetch_url] Received {len(text)} chars (trimmed to {max(0, min(max_chars, len(text)))})"
        )
    return text[: max(0, max_chars)]


def build_agent() -> None:
    from langchain_core.tools import tool  # type: ignore[reportMissingTypeStubs]
    from langchain_openai import ChatOpenAI  # type: ignore[reportMissingTypeStubs]
    from langgraph.prebuilt import create_react_agent  # type: ignore[reportMissingTypeStubs]

    edison = Edison(
        api_base=(os.getenv("OPEN_EDISON_API_BASE", "http://localhost:3001")).rstrip("/"),
        api_key=os.getenv("OPEN_EDISON_API_KEY", "dev-api-key-change-me"),
    )

    @tool  # type: ignore[misc]
    @edison.track()  # type: ignore[misc]
    def web_search(query: str, max_results: int = 3) -> str:
        """Search the web for the given query and return up to N result URLs."""
        urls = _duckduckgo_search(query, max_results=max_results)
        return "\n".join(urls)

    @tool  # type: ignore[misc]
    @edison.track()  # type: ignore[misc]
    def fetch_url(url: str, max_chars: int = 4000) -> str:
        """Fetch a URL and return the first max_chars of body text."""
        return _http_fetch(url, max_chars=max_chars)

    llm = ChatOpenAI()  # type: ignore[reportUnknownVariableType]
    agent = create_react_agent(model=llm, tools=[web_search, fetch_url])

    # Demo conversation
    messages = [
        ("user", "Find the official CPython docs homepage and fetch its first 1000 characters."),
    ]

    # Stream progress and results as they happen
    def print_stream(stream):
        for s in stream:
            try:
                message = s["messages"][-1]
                pretty = getattr(message, "pretty_print", None)
                if callable(pretty):
                    pretty()
                else:
                    print(message)
            except Exception:
                print(s)

    inputs = {"messages": messages}
    print_stream(agent.stream(inputs, stream_mode="values"))


def main() -> None:
    try:
        build_agent()
    except Exception as e:  # noqa: BLE001
        print("ReAct agent failed:", e)


if __name__ == "__main__":
    main()
