## LangGraph Integration (Decorator-First)

This document outlines a greenfield integration that lets developers add Open Edison tools to a LangGraph agent using only decorators. The goal is a clean DX with minimal boilerplate: define tools via decorators, optionally autoload from Open Edison, and build an agent without manually passing tool lists.

### Status

- Design documented here. Implementation not yet merged.

## Requirements

- Python 3.12+
- Packages (planned):
  - `fastmcp` (Open Edison MCP client)
  - `langgraph`
  - `langchain-core` (runtime tool protocol types)
- Environment variables (must be set by the integrator):
  - `OPEN_EDISON_URL` (e.g., `http://localhost:3000/mcp/`)
  - `OPEN_EDISON_API_KEY` (if your instance requires auth)

## Quickstart (planned DX)

```python
# pip install fastmcp langgraph langchain-core
from open_edison_langgraph import Edison

edison = Edison()  # reads OPEN_EDISON_URL / OPEN_EDISON_API_KEY

@edison.tool("builtin_get_available_tools")
async def list_tools() -> str:
    """List tools from Open Edison."""

@edison.tool("filesystem.read_file", name="fs.read")
async def read_file(path: str) -> str:
    """Read a file via Open Edison."""

@edison.agent(model="your_model_id", prompt="You are a helpful assistant.")
def agent(): ...

# Usage
# response = await agent.ainvoke({
#     "messages": [{"role": "user", "content": "Show README.md"}]
# })
# print(response)
```

Key properties:

- No manual tool list; `@edison.agent` introspects the module for registered tools.
- Type hints on function signatures are for developer clarity; runtime validation is derived from Open Edison JSON Schemas.

## Autoload Many Tools

```python
@edison.autoload("github.*", prefix="gh.")
async def _github_bundle(): ...
```

- Fetches tool metadata from Open Edison, filters by glob, registers proxies with optional `prefix` to avoid name collisions.

## API (planned)

```python
class Edison:
    def __init__(self, url: str | None = None, api_key: str | None = None,
                 timeout_s: float = 30.0,
                 return_raw: bool = False,
                 session_id: str | None = None):
        """Create an Edison wrapper. Defaults read from env.
        - OPEN_EDISON_URL, OPEN_EDISON_API_KEY, OPEN_EDISON_SESSION_ID
        - return_raw: if True, return raw MCP ToolResult content instead of text.
        """

    def tool(self, tool_name: str, *, name: str | None = None,
             description: str | None = None, prefix: str | None = None):
        """Decorator: register a single Open Edison tool by fully-qualified name
        (e.g., "filesystem.read_file"). Uses remote JSON Schema to build an
        args schema and calls through MCP at runtime.
        """

    def autoload(self, pattern: str, *, prefix: str | None = None):
        """Decorator: bulk-register multiple tools matching a glob-like pattern
        (e.g., "github.*"). Tools are discovered from Open Edison.
        """

    def agent(self, *, model: str, prompt: str, tools: list | None = None):
        """Decorator: build a LangGraph ReAct agent. If `tools` is omitted,
        collect all tools registered in the caller's module (introspection)."""

    async def collect_tools(self) -> list:
        """Return the list of bound tool callables currently registered
        on this Edison instance (useful for explicit wiring)."""

    async def react_agent(self, *, model: str, prompt: str,
                          tools: list | None = None):
        """Programmatic alternative to @agent decorator for explicit builds."""
```

## How It Works

- Discovery and schema cache: Edison lazily calls `builtin_get_available_tools` once and caches tool metadata (name, description, input_schema, output_schema).
- JSON Schema → Pydantic: Build argument models dynamically (strings, integers, numbers, booleans, arrays, objects) and mark required fields accordingly.
- Invocation: Calls Open Edison via `fastmcp.Client.call_tool(tool_name, args)`; returns normalized text by default.
- Introspection: `@edison.tool` and `@edison.autoload` register proxies in a per-module registry. `@edison.agent` inspects the caller module and composes tools automatically.

## Result Normalization

- Default behavior: collapse `ToolResult.content` textual parts into a single string appropriate for LLM consumption.
- `return_raw=True`: return the raw structured content; useful for programmatic downstreams.

## Session Awareness

- If `OPEN_EDISON_SESSION_ID` (or `session_id=` at init) is set, Edison will forward it (e.g., via header or context) so Open Edison can tie approvals, telemetry, and the session log to the same conversation.

## Error Handling

- Exceptions from Open Edison are propagated without masking so developer tooling and logs show root causes. Follow-up retries/timeouts are configurable (`timeout_s`).

## Security Notes

- Open Edison enforces per-tool permissions; blocked calls will result in clear errors. If your Open Edison is configured to require approvals, the client call will await approval (subject to timeout) and either proceed or raise.

## Limitations and TODOs (pre-implementation)

- JSON Schema features to expand: `enum`, `oneOf/anyOf/allOf`, format coercions (e.g., `uri`, `email`), nested arrays/objects edge cases.
- Streaming tool outputs (if/when exposed by MCP) are not yet surfaced to LangGraph.
- Resource and prompt surfaces (`@edison.resource`, `@edison.prompt`) are planned but not included in the first cut.
- Multi-instance support (multiple Open Edison backends) will be supported via creating multiple `Edison` instances.

## FAQ

- "Do I need to pass `tools=[...]` to LangGraph?"
  - No, not with `@edison.agent`. It collects decorated tools automatically. You can still build explicitly via `react_agent`.
- "What is the default URL?"
  - `http://localhost:3000/mcp/` if `OPEN_EDISON_URL` is not set.
- "Can I rename tools?"
  - Yes: use `name=` and/or `prefix=` on decorators.

## Example End-to-End (planned)

```python
from open_edison_langgraph import Edison

edison = Edison()

@edison.autoload("filesystem.*", prefix="fs.")
async def _fs(): ...

@edison.tool("builtin_get_available_tools")
async def list_tools() -> str: ...

@edison.agent(model="gpt-4o-mini", prompt="Use tools when helpful.")
def agent(): ...

# response = await agent.ainvoke({
#   "messages": [{"role": "user", "content": "fs.read README.md"}]
# })
```

---

If environment variables are set, this should work without any additional configuration when the integration is implemented.

## Wrapping at bind_tools and ToolNode (recommended path)

LangGraph’s prebuilts expect you to bind tools to the model and/or pass tools to `ToolNode`. We attach tracking and gating right at that seam.

### Minimal DX

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.graph import StateGraph, START, END
from langchain_core.tools import tool
from open_edison_langgraph import Edison

edison = Edison()

@tool
@edison.track()  # auto name, session via contextvar, approvals/trifecta, async logging
def cleanse_text(text: str) -> str:
    return text.strip()

tools = edison.wrap_tools([cleanse_text])  # converts any Tool/Callable to tracked Tool

llm = ChatOpenAI()
llm_with_tools = edison.bind_tools(llm, tools)  # sugar: wraps then calls llm.bind_tools

builder = StateGraph(dict)

def chatbot(state):
    return {"messages": [llm_with_tools.invoke(state["messages"]) ]}

builder.add_node("chatbot", chatbot)
builder.add_node("tools", ToolNode(tools=tools))
builder.add_conditional_edges("chatbot", tools_condition)
builder.add_edge("tools", "chatbot")
builder.add_edge(START, "chatbot")
graph = builder.compile()
```

- No changes to LangGraph’s flow; we wrap the tools you already pass at `bind_tools` and `ToolNode`.
- Works with `@tool` functions, plain callables, or existing `Tool` objects.

### API (wrapping layer)

```python
class Edison:
    def track(self, session_id: str | None = None):
        """Decorator: add tracked, gated execution with session context and async logging."""

    def wrap_tools(self, tools: list) -> list:
        """Return wrapped tool objects (tracking + gating) from callables or Tool instances."""

    def bind_tools(self, llm, tools: list):
        """Wrap tools then call llm.bind_tools(tools), returning the bound LLM."""
```

### Where this hooks into Open Edison

- Pre-call: treated as virtual tools named `client.<function_name>`, passed through `DataAccessTracker` for permissions + lethal-trifecta checks. If configured, approvals are requested using the same `events.wait_for_approval` mechanism.
- Post-call: results persisted to `sessions.db` (same schema as MCP tool calls), and `sessions_db_changed` is emitted for the dashboard.

For more on prebuilts, see LangGraph’s docs on using `ToolNode` and `tools_condition` and binding tools to an LLM: `https://langchain-ai.github.io/langgraph/tutorials/get-started/2-add-tools/#9-use-prebuilts`.

## File layout (planned, kept separate under src/langgraph_integration)

- `src/langgraph_integration/edison.py`
  - `Edison` class: `session()`, `track()`, `wrap_tools()`, `bind_tools()`
- `src/langgraph_integration/worker.py`
  - Background queue + HTTP client for `/track/begin` and `/track/end`
- `src/langgraph_integration/redaction.py`
  - Args summarization/redaction policies
- `src/langgraph_integration/tracking_api.py`
  - FastAPI router with `POST /track/begin` and `POST /track/end`
  - Reuses `DataAccessTracker`, `events.wait_for_approval`, and `sessions.db` persistence
- `src/server.py`
  - Mount the router in `_register_routes(...)` with API-key auth dependency (one line include)
- `examples/langgraph/agent_sample.py`
  - Minimal, runnable sample used in docs
- `tests/langgraph_integration/test_tracking.py`
  - Integration tests covering begin/end, approvals, permissions, persistence

Notes:

- No changes to existing middleware; tracking API mounts alongside current management endpoints.
- `client.<function_name>` names can be managed via `tool_permissions.json` like any other tool.

## Function Call Tracking with @edison.track() (planned)

Purpose: allow arbitrary Python functions (used inside a LangGraph agent) to be tracked in the Open Edison session log and receive the same permissions/approvals and lethal-trifecta gating as MCP tool calls.

### DX

```python
from open_edison_langgraph import Edison

edison = Edison()  # reads OPEN_EDISON_URL / OPEN_EDISON_API_KEY

# Option A: set a session id for the current context (like Langfuse context)
with edison.session("session-123"):  # stores a contextvar
    @edison.track()
    def cleanse_text(text: str) -> str:
        return text.strip()

    @edison.track()
    async def summarize(text: str) -> str:
        ...

    # Calls are tracked automatically, with trifecta gating parity
    msg = cleanse_text("  hello  ")

# Option B: override session id per-call (kwarg)
cleanse_text("hello", __edison_session_id="override-456")
```

Notes:

- The decorator derives the function name automatically (e.g., `client.cleanse_text`).
- Session id comes from a contextvar by default; override per call via the reserved kwarg `__edison_session_id`.
- Both sync and async functions are supported.

### Behavior

- Pre-call (gated): the wrapper enqueues a "begin" event to a background worker. The worker contacts Open Edison to register a tool-like call named `client.<function_name>`, applies the same permissions and trifecta checks used for MCP tools, and blocks for approval if configured. If blocked/denied, the wrapper raises before executing the function.
- Post-call: on completion, the wrapper enqueues an "end" event with status (ok/error) and duration. The server persists the call to `sessions.db` so it appears in the dashboard timeline.
- Non-blocking DX: the decorator queues work to a background thread so your function logic is minimally impacted. Only the approval gate (if triggered) blocks the function call until allowed or timed out.

### Parity with MCP tools (permissions, trifecta, approvals)

- Server-side, tracked functions are treated as tools with names `client.<function_name>` and processed by the same `DataAccessTracker` rules:
  - Tool enable/disable via config
  - ACL/write-downgrade checks
  - Lethal-trifecta prevention and manual approvals
  - Telemetry counters
- Configuration: operators can define policies for `client.*` tools in `config.json` just like any other tool (e.g., classify a specific function as external-communication).

### Session propagation

- Default: decorator uses a contextvar set by `with edison.session("id"):`. If the contextvar is None, Edison auto-mints a new session id (UUIDv4) and stores it in the contextvar so subsequent calls share it.
- Override: pass `__edison_session_id="..."` when calling the function. This mirrors the Langfuse-style context override pattern.
- Optional: you can seed the context explicitly with `Edison.session(os.getenv("OPEN_EDISON_SESSION_ID"))` if you want to align with an existing id, but auto-minting is the default when unset.

### Transport and persistence

- Client background worker batches events and sends them to Open Edison via a management API designed for tracking:
  - `POST /track/begin` — body: `{ session_id, name, args_summary }` → returns `{ ok: bool, call_id: str, approved: bool }`
  - `POST /track/end` — body: `{ session_id, call_id, status: "ok"|"error", duration_ms }`
- The server updates `sessions.db` through the existing SQLAlchemy models; the dashboard reacts via `sessions_db_changed` events.

### Redaction and safety

- By default, arguments are summarized (type names and small primitives) to avoid leaking sensitive data. A future `Edison(..., redact_args=True|False, custom_redactor=callable)` will control this.

### Error model

- If permission checks or trifecta gating block the call and are not approved in time, the decorator raises a security error before executing the function body.
- Network/transport errors to Open Edison result in a clear exception; optionally, a tolerant mode may downgrade to best-effort logging without gating (not recommended by default).

### Example in a LangGraph agent

```python
from langgraph.prebuilt import create_react_agent
from open_edison_langgraph import Edison

edison = Edison()

with edison.session("sess-789"):
    @edison.track()
    def cleanse_text(text: str) -> str:
        return text.strip()

    @edison.track()
    async def summarize(text: str) -> str:
        ...

    agent = create_react_agent(
        model="your_model_id",
        tools=[cleanse_text, summarize],  # or use them inside custom graph nodes
        prompt="You are helpful."
    )

    # response = await agent.ainvoke({"messages": [{"role": "user", "content": "Summarize ..."}]})
```

### Implementation sketch (client)

- `Edison.session(session_id: str | None = None)` context manager sets the session contextvar; if `None`, a UUIDv4 is minted and set.
- `@edison.track(session_id: str | None = None)` returns a wrapper that:
  1) resolves the session id (kwarg override → decorator arg → contextvar → auto-mint UUIDv4)
  2) captures function name via introspection
  3) enqueues `begin(session_id, name, args_summary)` and awaits approval result
  4) executes the function if approved
  5) enqueues `end(session_id, call_id, status, duration_ms)`
- A background worker thread drains a queue and makes HTTP calls to the server; retries with jitter on transient failures.

### Implementation sketch (server)

- Add tracking endpoints that reuse existing session/tracker logic:
  - Resolve/initialize session (same DB and context handling as middleware)
  - Treat `name` as a tool key (`client.<function_name>`) and call `DataAccessTracker.add_tool_call(name)` for gating
  - If blocked: emit `mcp_pre_block` and wait for approval using `events.wait_for_approval`
  - Persist to `mcp_sessions` with the same shape as MCP tool calls
  - Emit `sessions_db_changed` events so the dashboard refreshes

This yields decorator-only tracking for arbitrary Python functions with full parity to MCP tools, minimal boilerplate, and strong session semantics for LangGraph agents.
