"""
Long-running LangGraph ReAct agent that exercises many tracked tools.

Run:
  OPENAI_API_KEY=... uv run python examples/langgraph/long_running_toolstorm_agent.py

Notes:
- Requires Open Edison management API running (default: http://localhost:3001)
- Tools are decorated with @edison.track() so calls are gated/logged
- Designed to generate many tool calls: searches, fetches, math, sleeps, etc.
"""

import datetime as dt
import random
import re
import time
import urllib.parse
from typing import Any

import httpx
from bs4 import BeautifulSoup  # type: ignore[reportMissingTypeStubs]
from dotenv import load_dotenv
from langchain_core.tools import tool  # type: ignore[reportMissingTypeStubs]
from langchain_openai import ChatOpenAI  # type: ignore[reportMissingTypeStubs]
from langgraph.prebuilt import create_react_agent  # type: ignore[reportMissingTypeStubs]
from loguru import logger as log

from src.langgraph_integration import Edison  # type: ignore[reportMissingTypeStubs]


load_dotenv()


def _duckduckgo_search(query: str, max_results: int = 5) -> list[str]:
    q = urllib.parse.quote_plus(query)
    url = f"https://duckduckgo.com/html/?q={q}"
    with httpx.Client(timeout=15.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
        resp = client.get(url)
    html = resp.text
    urls: list[str] = []
    for m in re.finditer(r"href=\"/l/\?uddg=([^&\"]+)", html):
        enc = m.group(1)
        decoded = urllib.parse.unquote(enc)
        if decoded.startswith("http"):
            urls.append(decoded)
        if len(urls) >= max_results:
            break
    return urls


def _http_fetch(url: str, max_chars: int = 4000) -> str:
    with httpx.Client(timeout=20.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
        r = client.get(url, follow_redirects=True)
    body = r.text or ""
    try:
        soup = BeautifulSoup(body, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    except Exception:
        log.warning("Error parsing URL result")
        text = body
    return text[: max(0, max_chars)]


def build_agent() -> None:
    edison = Edison()

    # Web tools
    @tool  # type: ignore[misc]
    @edison.track()
    def web_search(query: str, max_results: int = 5) -> str:
        """Search the web and return up to N result URLs."""
        return "\n".join(_duckduckgo_search(query, max_results=max_results))

    @tool  # type: ignore[misc]
    @edison.track()
    def fetch_url(url: str, max_chars: int = 4000) -> str:
        """Fetch a URL and return first max_chars of readable text."""
        return _http_fetch(url, max_chars=max_chars)

    @tool  # type: ignore[misc]
    @edison.track()
    def http_head(url: str) -> dict[str, Any]:
        """Perform an HTTP HEAD request and return status and headers."""
        with httpx.Client(timeout=10.0) as client:
            resp = client.head(url, follow_redirects=True)
        return {"status_code": resp.status_code, "headers": dict(resp.headers)}

    # Text utilities
    @tool  # type: ignore[misc]
    @edison.track()
    def summarize(text: str, max_sentences: int = 3) -> str:
        """Naive summary: first N sentences (split on period)."""
        parts = re.split(r"(?<=[.!?])\s+", text)
        return " ".join(parts[: max(1, max_sentences)])

    @tool  # type: ignore[misc]
    @edison.track()
    def regex_extract(text: str, pattern: str) -> list[str]:
        """Return all regex matches (group 0)."""
        try:
            return re.findall(pattern, text)
        except re.error as e:  # noqa: BLE001
            return [f"regex error: {e}"]

    @tool  # type: ignore[misc]
    @edison.track()
    def token_count(text: str) -> int:
        """Approximate token count by splitting on whitespace."""
        return len(text.split())

    # Math and randomness
    @tool  # type: ignore[misc]
    @edison.track()
    def add(a: float, b: float) -> float:
        """Return a + b."""
        return a + b

    @tool  # type: ignore[misc]
    @edison.track()
    def multiply(a: float, b: float) -> float:
        """Return a * b."""
        return a * b

    @tool  # type: ignore[misc]
    @edison.track()
    def random_int(low: int = 0, high: int = 10) -> int:
        """Return a random integer in [low, high]."""
        return random.randint(low, high)

    # Time and pacing
    @tool  # type: ignore[misc]
    @edison.track()
    def now_iso() -> str:
        """Return current UTC time in ISO 8601 format."""
        now = dt.datetime.now(dt.UTC)
        return now.isoformat().replace("+00:00", "Z")

    @tool  # type: ignore[misc]
    @edison.track()
    def sleep_ms(ms: int = 200) -> str:
        """Sleep for N milliseconds to simulate long/slow chains."""
        s = max(0.0, float(ms) / 1000.0)
        time.sleep(s)
        return f"slept {ms}ms"

    # Collections
    @tool  # type: ignore[misc]
    @edison.track()
    def list_top(items: list[str], n: int = 3) -> list[str]:
        """Return the first N items of a list."""
        return items[: max(0, n)]

    @tool  # type: ignore[misc]
    @edison.track()
    def dict_keys(d: dict[str, Any]) -> list[str]:
        """Return keys of a dictionary."""
        return list(d.keys())

    # Build LLM + agent
    llm = ChatOpenAI()  # type: ignore[reportUnknownVariableType]
    tools = [
        web_search,
        fetch_url,
        http_head,
        summarize,
        regex_extract,
        token_count,
        add,
        multiply,
        random_int,
        now_iso,
        sleep_ms,
        list_top,
        dict_keys,
    ]
    agent = create_react_agent(model=llm, tools=tools)  # type: ignore[reportUnknownReturnType]

    # A compound task that should cause the agent to use many tools (aim for 12+ calls)
    messages = [
        (
            "user",
            (
                "Conduct a mini literature sweep on efficient long-context Transformer variants "
                "published on arXiv in the last 30 days. Follow these steps and use tools explicitly "
                "to demonstrate your work (aim for 12+ tool calls):\n\n"
                "1) Discovery: Use web_search to find 3–5 very recent arXiv entries (provide arXiv ID, "
                "title, and URL). Prefer topics like long-context attention, RoPE/ALiBi variants, MoE, or retrieval-augmented LLMs.\n"
                "2) Abstracts: For each paper, fetch_url the arXiv abs page and extract: model name (if any), "
                "claimed max context length, parameter count (M or B), and training/inference throughput (tokens/s) if present. "
                "If a direct PDF URL is available, perform http_head on it and capture status and headers.\n"
                "3) Metrics: Compute a simple efficiency score per paper = (throughput or tokens/s if present) / parameters_in_M. "
                "If throughput is missing, estimate a proxy using token_count of the abstract and a simple heuristic, and show working using add/multiply.\n"
                "4) Concepts: Identify 1–2 key concepts mentioned (e.g., Rotary embeddings, ALiBi, Mixture-of-Experts). For one concept, fetch_url the Wikipedia article, then follow its first two references "
                "to primary sources (use regex_extract to pull titles/links), forming a short chain of references.\n"
                "5) Summaries: summarize each abstract to 2–3 sentences; also report token_count for each abstract.\n"
                "6) Ranking: Use your efficiency score to rank papers; list_top the top 3.\n"
                "7) Pacing/Meta: Between major steps, sleep_ms for 150–300ms. Include now_iso and dict_keys of the HEAD response headers for one PDF URL.\n\n"
                "Return a concise bullet-point report with: discoveries (IDs/titles/links), key metrics, computed scores with working, reference chain summary, and the ranked top 3."
            ),
        )
    ]

    inputs: dict[str, Any] = {"messages": messages}
    result = agent.invoke(inputs, config={"recursion_limit": 120})  # type: ignore[reportUnknownReturnType]
    print(result["messages"][-1].content)


def main() -> None:
    build_agent()


if __name__ == "__main__":
    main()
