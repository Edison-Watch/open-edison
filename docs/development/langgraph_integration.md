## LangGraph Integration (Agent/Server Split)

This document specifies a clean separation between Agent-side code (your LangGraph app) and Server-side logic (Open Edison).

### Roles

- Agent (A): wraps your LangGraph tools to ask OE for permission before execution, and reports completion afterwards. The Agent mints/provides its own session id.
- Server (S): Open Edison. Applies the standard permissions/trifecta gating and persists calls to `sessions.db`. Approvals happen via the dashboard.

### Endpoints (Server-side, FastAPI)

- `POST /agent/session` (optional): ensure a session exists.
- `POST /agent/begin`: pre-call permission check and pending-call registration.
- `POST /agent/end`: post-call status/duration/result update.

All routes are API-key protected (same dependency as other management endpoints). Calls are persisted to the same tables and raise the same events as MCP tool calls.

### Request/Response Shapes

- Begin request: `{ session_id?: str, name: str, args_summary?: str, timeout_s?: float }`
  - `session_id` may be omitted; the server will mint one if not provided.
- Name is normalized to `agent_<function_name>`.
  - Response: `{ ok: bool, session_id: str, call_id: str|null, approved: bool|null, error: str|null }`.
- End request: `{ session_id: str, call_id: str, status: "ok"|"error", duration_ms?: float, result_summary?: str }`.

### Agent Library (Edison)

- Session handling
  - Contextvar stores current `session_id`. If absent, mint UUIDv4 and set.
  - Per-call override: pass `__edison_session_id="..."` to the wrapped function.
- Decorator `@edison.track(name?: str)`
  - Before body: POST `/agent/begin` and block for approval (with timeout). On deny/timeout → raise `PermissionError`.
  - After body: enqueue POST `/agent/end` via a background worker (with retry backoff).
  - Preserves function metadata via `functools.wraps` so LangGraph/`@tool` works.
- Healthcheck on init (optional)
  - Logs if `/health` unreachable or API key invalid on `/mcp/status`.

### Permissions and Naming

- Tracked functions are treated as tools named `agent_<function_name>`.
- Configure permissions under an `agent` section in `tool_permissions.json` using the same `agent_<name>` keys.
- Server reuses `DataAccessTracker` for lethal-trifecta and other policy checks.

### Data Model and Persistence

- Reuse `MCPSession` and `ToolCall` models. Calls appear in the dashboard timeline.
- Parameters store `summary` (from `args_summary`) and `result_summary` (from `result_summary`).
- Previews are capped at 1,000,000 characters; no redaction by default.

### Example (minimal)

```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from open_edison import Edison

edison = Edison()  # uses OPEN_EDISON_API_BASE and OPEN_EDISON_API_KEY

@tool
@edison.track()
def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

llm = ChatOpenAI()
llm_with_tools = edison.bind_tools(llm, [multiply])
# Invoke your graph/model with llm_with_tools
```

### Server Wiring

- The `/agent/*` routes are mounted alongside existing management routes and reuse:
  - `get_session_from_db`, `create_db_session`, `MCPSessionModel`
  - `DataAccessTracker` (permissions/trifecta), `events.wait_for_approval`
  - `record_tool_call`, `sessions_db_changed` emission

### Errors and Edge Cases

- Server down/unhealthy → begin raises `RuntimeError` (function not executed).
- Approval denied/timeout → begin returns approved=false and client raises `PermissionError`.
- End reports are idempotent on `call_id`; background worker retries with backoff.

### Notes

- Approvals are handled in the dashboard; no client-side approval calls.
- Agent does not start MCP servers; it only talks to management API.
- MCP tool calls and agent calls are unified in `sessions.db` and the dashboard.
