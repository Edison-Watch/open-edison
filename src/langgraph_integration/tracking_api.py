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
from sqlalchemy.sql import select  # type: ignore[reportMissingImports]

from src import events
from src.middleware.data_access_tracker import SecurityError  # type: ignore[reportMissingImports]
from src.middleware.session_tracking import (  # type: ignore[reportMissingImports]
    MCPSession,
    MCPSessionModel,
    ToolCall,
    create_db_session,
    get_session_from_db,
)
from src.permissions import ToolPermission  # type: ignore[reportMissingImports]
from src.telemetry import record_tool_call  # type: ignore[reportMissingImports]


class _BeginBody(BaseModel):
    session_id: str | None = Field(default=None, description="Session id; server will mint if None")
    name: str = Field(
        ..., description="Function/tool name (will be treated as client.<name> if no prefix)"
    )
    args_summary: str | None = Field(default=None, description="Redacted/summary of args")
    timeout_s: float | None = Field(30.0, description="Approval wait timeout in seconds")
    overrides: dict[str, dict[str, Any]] | None = Field(
        default=None,
        description="Optional per-session tool overrides under exact tool names (e.g., client.multiply)",
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
    if raw.startswith("agent."):
        return raw
    return f"agent.{raw}"


agent_router = APIRouter(prefix="/agent", tags=["agent"])


# Legacy /track routes removed; use /agent equivalents


@agent_router.post("/begin", response_model=_BeginResponse)
async def agent_begin(body: _BeginBody) -> Any:  # type: ignore[override]
    try:
        session_id = body.session_id or str(uuid.uuid4())
        name = _normalize_name(body.name)
        timeout: float = float(body.timeout_s) if isinstance(body.timeout_s, int | float) else 30.0

        # Get or create session object
        session: MCPSession = get_session_from_db(session_id)

        # Create a pending tool call immediately for UI visibility
        call_id = str(uuid.uuid4())
        pending_call = ToolCall(
            id=call_id,
            tool_name=name,
            parameters={"summary": body.args_summary} if body.args_summary else {},
            timestamp=datetime.now(),
        )
        session.tool_calls.append(pending_call)

        # Apply optional per-session overrides once
        if body.overrides:
            try:
                assert session.data_access_tracker is not None
                session.data_access_tracker.tool_overrides = {
                    k: ToolPermission(**v) for k, v in body.overrides.items()
                }
            except Exception:
                pass

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
                _persist_session(session)
                return _BeginResponse(
                    ok=True, session_id=session_id, call_id=call_id, approved=False, error=str(e)
                )

            # Approved: apply effects and proceed
            assert session.data_access_tracker is not None
            session.data_access_tracker.apply_effects_after_manual_approval("tool", name)

        # Telemetry and persistence for pending call
        record_tool_call(name)
        _persist_session(session)

        return _BeginResponse(ok=True, session_id=session_id, call_id=call_id, approved=True)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return _BeginResponse(
            ok=False, session_id=body.session_id or "", call_id=None, approved=None, error=str(e)
        )


@agent_router.post("/end", response_model=_EndResponse)
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

        _persist_session(session)
        return _EndResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to end tracking: {e}") from e


class _SessionBody(BaseModel):
    session_id: str = Field(..., description="Agent-provided session id")


class _SessionResponse(BaseModel):
    ok: bool
    session_id: str


@agent_router.post("/session", response_model=_SessionResponse)
async def agent_session(body: _SessionBody) -> Any:  # type: ignore[override]
    """Ensure a session exists and is persisted; return ok with session id."""
    try:
        session = get_session_from_db(body.session_id)
        _persist_session(session)
        return _SessionResponse(ok=True, session_id=body.session_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to upsert session: {e}") from e


def get_agent_router() -> APIRouter:
    """Factory for including the agent router (alias of tracking routes)."""
    return agent_router


def _persist_session(session: MCPSession) -> None:
    """Serialize and persist the given session to the SQLite database.

    Mirrors the persistence strategy used by the MCP middleware, without relying on its private helper.
    """
    with create_db_session() as db_session:
        db_session_model = db_session.execute(
            select(MCPSessionModel).where(MCPSessionModel.session_id == session.session_id)
        ).scalar_one()

        tool_calls_dict = [
            {
                "id": tc.id,
                "tool_name": tc.tool_name,
                "parameters": tc.parameters,
                "timestamp": tc.timestamp.isoformat(),
                "duration_ms": tc.duration_ms,
                "status": tc.status,
                "result": tc.result,
            }
            for tc in session.tool_calls
        ]
        db_session_model.tool_calls = tool_calls_dict  # type: ignore[attr-defined]
        # Merge existing summary with tracker dict so we preserve created_at and other keys
        existing_summary: dict[str, Any] = {}
        try:
            raw = db_session_model.data_access_summary  # type: ignore[attr-defined]
            if isinstance(raw, dict):
                existing_summary = dict(raw)
        except Exception:
            existing_summary = {}
        updates: dict[str, Any] = (
            session.data_access_tracker.to_dict() if session.data_access_tracker is not None else {}
        )
        merged = {**existing_summary, **updates}
        db_session_model.data_access_summary = merged  # type: ignore[attr-defined]
        db_session.commit()
