"""
Long-running LangGraph ReAct agent that exercises many tracked tools.

Run:
  OPENAI_API_KEY=... [OPENAI_MODEL=gpt-4.1] uv run python examples/langgraph/long_running_toolstorm_agent.py

Notes:
- Requires Open Edison management API running (default: http://localhost:3001)
- Tools are decorated with @edison.track() so calls are gated/logged
- Designed to generate many tool calls: searches, fetches, math, sleeps, etc.
- The OpenAI chat model can be selected via the OPENAI_MODEL env var (default: gpt-4.1)
"""

import datetime as dt
import os
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


def web_search_fn(query: str, max_results: int = 5) -> str:
    """Search the web and return up to N result URLs."""
    return "\n".join(_duckduckgo_search(query, max_results=max_results))


def fetch_url_fn(url: str, max_chars: int = 4000) -> str:
    """Fetch a URL and return first max_chars of readable text."""
    return _http_fetch(url, max_chars=max_chars)


def http_head_fn(url: str) -> dict[str, Any]:
    """Perform an HTTP HEAD request and return status and headers."""
    with httpx.Client(timeout=10.0) as client:
        resp = client.head(url, follow_redirects=True)
    return {"status_code": resp.status_code, "headers": dict(resp.headers)}


def summarize_fn(text: str, max_sentences: int = 3) -> str:
    """Naive summary: first N sentences (split on period)."""
    parts = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(parts[: max(1, max_sentences)])


def regex_extract_fn(text: str, pattern: str) -> list[str]:
    """Return all regex matches (group 0)."""
    try:
        return re.findall(pattern, text)
    except re.error as e:  # noqa: BLE001
        return [f"regex error: {e}"]


def token_count_fn(text: str) -> int:
    """Approximate token count by splitting on whitespace."""
    return len(text.split())


def add_fn(a: float, b: float) -> float:
    """Return a + b."""
    return a + b


def multiply_fn(a: float, b: float) -> float:
    """Return a * b."""
    return a * b


def random_int_fn(low: int = 0, high: int = 10) -> int:
    """Return a random integer in [low, high]."""
    return random.randint(low, high)


def now_iso_fn() -> str:
    """Return current UTC time in ISO 8601 format."""
    now = dt.datetime.now(dt.UTC)
    return now.isoformat().replace("+00:00", "Z")


def sleep_ms_fn(ms: int = 200) -> str:
    """Sleep for N milliseconds to simulate long/slow chains."""
    s = max(0.0, float(ms) / 1000.0)
    time.sleep(s)
    return f"slept {ms}ms"


def list_top_fn(items: list[str], n: int = 3) -> list[str]:
    """Return the first N items of a list."""
    return items[: max(0, n)]


def dict_keys_fn(d: dict[str, Any]) -> list[str]:
    """Return keys of a dictionary."""
    return list(d.keys())


def build_agent() -> None:
    edison = Edison()

    # Build LLM + agent
    # Prefer a long-context model by default; allow override via OPENAI_MODEL
    # Examples: gpt-4.1 (very large context), gpt-4o (128k context)
    model_name = os.environ.get("OPENAI_MODEL", "gpt-4.1")
    llm = ChatOpenAI(model=model_name)  # type: ignore[reportUnknownVariableType]

    # Wrap tool functions with edison.track() first, then mark as LangChain tools
    tools = [
        tool(edison.track()(web_search_fn)),
        tool(edison.track()(fetch_url_fn)),
        tool(edison.track()(http_head_fn)),
        tool(edison.track()(summarize_fn)),
        tool(edison.track()(regex_extract_fn)),
        tool(edison.track()(token_count_fn)),
        tool(edison.track()(add_fn)),
        tool(edison.track()(multiply_fn)),
        tool(edison.track()(random_int_fn)),
        tool(edison.track()(now_iso_fn)),
        tool(edison.track()(sleep_ms_fn)),
        tool(edison.track()(list_top_fn)),
        tool(edison.track()(dict_keys_fn)),
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
