"""
Agent API for LangGraph function instrumentation.

Provides begin/end endpoints that mirror MCP tool-call tracking semantics:
- Permissions and lethal-trifecta gating via DataAccessTracker
- Manual approvals via events.wait_for_approval
- Persistence to sessions.db so calls appear in the dashboard timeline
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src import events
from src.middleware.data_access_tracker import SecurityError  # type: ignore[reportMissingImports]
from src.middleware.session_tracking import (  # type: ignore[reportMissingImports]
    MCPSession,
    ToolCall,
    _persist_session_to_db,  # type: ignore[reportPrivateImport]
    get_session_from_db,
)
from src.telemetry import record_tool_call  # type: ignore[reportMissingImports]


class _BeginBody(BaseModel):
    session_id: str | None = Field(default=None, description="Session id; server will mint if None")
    name: str = Field(..., description="Function/tool name (treated as agent_<name> if no prefix)")
    args_summary: str | None = Field(default=None, description="Redacted/summary of args")
    timeout_s: float | None = Field(30.0, description="Approval wait timeout in seconds")
    agent_name: str | None = Field(
        default=None, description="Agent identity (e.g., 'hr_assistant')"
    )
    agent_type: str | None = Field(
        default=None, description="Agent type/role (e.g., 'hr', 'engineering')"
    )


class _BeginResponse(BaseModel):
    ok: bool
    session_id: str
    call_id: str | None = None
    approved: bool | None = None
    error: str | None = None


class _EndBody(BaseModel):
    session_id: str = Field(...)
    call_id: str = Field(...)
    status: Literal["ok", "error", "blocked"] = Field(...)
    duration_ms: float | None = Field(default=None)
    result_summary: str | None = Field(default=None)


class _EndResponse(BaseModel):
    ok: bool


def _normalize_name(raw: str) -> str:
    if raw.startswith("agent_"):
        return raw
    return f"agent_{raw}"


agent_router = APIRouter(prefix="/agent", tags=["agent"])


# Legacy /track routes removed; use /agent equivalents


@agent_router.post("/begin", response_model=_BeginResponse)  # noqa
async def agent_begin(body: _BeginBody) -> Any:  # type: ignore[override]
    try:
        session_id = body.session_id or str(uuid.uuid4())
        name = _normalize_name(body.name)
        timeout: float = float(body.timeout_s) if isinstance(body.timeout_s, int | float) else 30.0

        # Get or create session object
        session: MCPSession = get_session_from_db(session_id)

        # Update agent identity if provided (first call sets it, subsequent calls preserve it)
        if body.agent_name and session.agent_name is None:
            session.agent_name = body.agent_name
            session.agent_type = body.agent_type
            assert session.data_access_tracker is not None
            session.data_access_tracker.agent_name = body.agent_name

        # Create a pending tool call immediately for UI visibility
        call_id = str(uuid.uuid4())
        pending_call = ToolCall(
            id=call_id,
            tool_name=name,
            parameters={"summary": body.args_summary} if body.args_summary else {},
            timestamp=datetime.now(),
        )
        session.tool_calls.append(pending_call)

        # Apply gating. If blocked, persist blocked and return approved=False
        try:
            assert session.data_access_tracker is not None
            session.data_access_tracker.add_tool_call(name)
        except SecurityError as e:
            # Notify listeners and await approval
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "tool",
                    "name": name,
                    "session_id": session_id,
                    "error": str(e),
                }
            )
            approved = await events.wait_for_approval(session_id, "tool", name, timeout_s=timeout)
            if not approved:
                pending_call.status = "blocked"
                _persist_session_to_db(session)
                return _BeginResponse(
                    ok=True, session_id=session_id, call_id=call_id, approved=False, error=str(e)
                )

            # Approved: apply effects and proceed
            assert session.data_access_tracker is not None
            session.data_access_tracker.apply_effects_after_manual_approval("tool", name)

        # Telemetry and persistence for pending call
        record_tool_call(name)
        _persist_session_to_db(session)

        return _BeginResponse(ok=True, session_id=session_id, call_id=call_id, approved=True)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return _BeginResponse(
            ok=False, session_id=body.session_id or "", call_id=None, approved=None, error=str(e)
        )


@agent_router.post("/end", response_model=_EndResponse)  # noqa
async def agent_end(body: _EndBody) -> Any:  # type: ignore[override]
    try:
        session = get_session_from_db(body.session_id)

        # Locate the call
        found = None
        for tc in session.tool_calls:
            if tc.id == body.call_id:
                found = tc
                break
        if found is None:
            raise HTTPException(status_code=404, detail="call_id not found in session")

        # Update and persist
        found.status = body.status
        found.duration_ms = body.duration_ms
        if body.result_summary is not None:
            try:
                params = dict(found.parameters or {})
            except Exception:
                params = {}
            params["result_summary"] = body.result_summary
            found.parameters = params

        _persist_session_to_db(session)
        return _EndResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to end tracking: {e}") from e
