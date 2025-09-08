"""
Session Tracking Middleware for Open Edison

This middleware tracks tool usage patterns across all mounted tool calls,
providing session-level statistics accessible via contextvar.
"""

import time
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import mcp.types as mt
from fastmcp.exceptions import ToolError
from fastmcp.prompts.prompt import FunctionPrompt
from fastmcp.resources import FunctionResource
from fastmcp.server.middleware import Middleware
from fastmcp.server.middleware.middleware import CallNext, MiddlewareContext
from fastmcp.server.proxy import ProxyPrompt, ProxyResource, ProxyTool
from fastmcp.tools import FunctionTool
from fastmcp.tools.tool import ToolResult
from loguru import logger as log
from sqlalchemy import JSON, Column, Integer, String, create_engine, event
from sqlalchemy.orm import Session, declarative_base
from sqlalchemy.sql import select

from src import events
from src.config import get_config_dir  # type: ignore[reportMissingImports]
from src.middleware.data_access_tracker import (
    DataAccessTracker,
    SecurityError,
)
from src.permissions import Permissions
from src.telemetry import (
    record_prompt_used,
    record_resource_used,
    record_tool_call,
)


@dataclass
class ToolCall:
    id: str
    tool_name: str
    parameters: dict[str, Any]
    timestamp: datetime
    duration_ms: float | None = None
    status: str = "pending"
    result: Any | None = None


@dataclass
class MCPSession:
    session_id: str
    correlation_id: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    data_access_tracker: DataAccessTracker | None = None


Base = declarative_base()


class MCPSessionModel(Base):  # type: ignore
    __tablename__: str = "mcp_sessions"
    id = Column(Integer, primary_key=True)  # type: ignore
    session_id = Column(String, unique=True)  # type: ignore
    correlation_id = Column(String)  # type: ignore
    tool_calls = Column(JSON)  # type: ignore
    data_access_summary = Column(JSON)  # type: ignore


current_session_id_ctxvar: ContextVar[str | None] = ContextVar(
    "current_session_id",
    default=cast(str | None, None),  # noqa: B039
)


def get_current_session_data_tracker() -> DataAccessTracker | None:
    """
    Get the data access tracker for the current session.

    Returns:
        DataAccessTracker instance for the current session, or None if no session
    """
    session_id = current_session_id_ctxvar.get()
    if session_id is None:
        return None

    try:
        session = get_session_from_db(session_id)
        return session.data_access_tracker
    except Exception as e:
        log.error(f"Failed to get current session data tracker: {e}")
        return None


@contextmanager
def create_db_session() -> Generator[Session, None, None]:
    """Create a db session to our local sqlite db (fixed location under config dir)."""
    try:
        cfg_dir = get_config_dir()
    except Exception:
        cfg_dir = Path.cwd()
    db_path = cfg_dir / "sessions.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}")

    # Ensure changes are flushed to the main database file (avoid WAL for sql.js compatibility)
    @event.listens_for(engine, "connect")  # noqa
    def _set_sqlite_pragmas(dbapi_connection, connection_record):  # type: ignore[no-untyped-def] # noqa
        cur = dbapi_connection.cursor()  # type: ignore[attr-defined]
        try:
            cur.execute("PRAGMA journal_mode=DELETE")  # type: ignore[attr-defined]
            cur.execute("PRAGMA synchronous=FULL")  # type: ignore[attr-defined]
        finally:
            cur.close()  # type: ignore[attr-defined]

    # Ensure tables exist
    Base.metadata.create_all(engine)  # type: ignore
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()


def get_session_from_db(session_id: str) -> MCPSession:
    """Get session from db"""
    with create_db_session() as db_session:
        session = db_session.execute(
            select(MCPSessionModel).where(MCPSessionModel.session_id == session_id)
        ).scalar_one_or_none()

        if session is None:
            # Create a new session model for the database
            new_session_model = MCPSessionModel(
                session_id=session_id,
                correlation_id=str(uuid.uuid4()),
                tool_calls=[],  # type: ignore
                # Store session creation timestamp inside the summary to avoid schema changes
                data_access_summary={"created_at": datetime.now().isoformat()},  # type: ignore
            )
            db_session.add(new_session_model)
            db_session.commit()

            # Return the MCPSession object
            return MCPSession(
                session_id=session_id,
                correlation_id=str(new_session_model.correlation_id),
                tool_calls=[],
                data_access_tracker=DataAccessTracker(),
            )
        # Return existing session
        tool_calls: list[ToolCall] = []
        if session.tool_calls is not None:  # type: ignore
            tool_calls_data = session.tool_calls  # type: ignore
            for tc_dict in tool_calls_data:  # type: ignore
                # Convert timestamp string back to datetime if it exists
                tc_dict_copy = dict(tc_dict)  # type: ignore
                if "timestamp" in tc_dict_copy:  # type: ignore
                    tc_dict_copy["timestamp"] = datetime.fromisoformat(tc_dict_copy["timestamp"])  # type: ignore
                tool_calls.append(ToolCall(**tc_dict_copy))  # type: ignore

        # Restore data access tracker from database if available
        data_access_tracker = DataAccessTracker()
        if hasattr(session, "data_access_summary") and session.data_access_summary:  # type: ignore
            summary_data = session.data_access_summary  # type: ignore
            if "lethal_trifecta" in summary_data:
                trifecta = summary_data["lethal_trifecta"]
                data_access_tracker.has_private_data_access = trifecta.get(
                    "has_private_data_access", False
                )
                data_access_tracker.has_untrusted_content_exposure = trifecta.get(
                    "has_untrusted_content_exposure", False
                )
                data_access_tracker.has_external_communication = trifecta.get(
                    "has_external_communication", False
                )
            # Restore ACL highest level if present
            if isinstance(summary_data, dict) and "acl" in summary_data:  # type: ignore
                acl_summary: Any = summary_data.get("acl")  # type: ignore
                if isinstance(acl_summary, dict):
                    highest = acl_summary.get("highest_acl_level")  # type: ignore
                    if isinstance(highest, str) and highest:
                        data_access_tracker.highest_acl_level = highest

        return MCPSession(
            session_id=session_id,
            correlation_id=str(session.correlation_id),
            tool_calls=tool_calls,
            data_access_tracker=data_access_tracker,
        )


def _persist_session_to_db(session: MCPSession) -> None:
    """Serialize and persist the given session to the SQLite database."""
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
        db_session_model.tool_calls = tool_calls_dict  # type: ignore
        # Merge existing summary with tracker dict so we preserve created_at and other keys
        existing_summary: dict[str, Any] = {}
        try:
            if isinstance(db_session_model.data_access_summary, dict):  # type: ignore
                existing_summary = dict(db_session_model.data_access_summary)  # type: ignore
        except Exception:
            existing_summary = {}
        updates: dict[str, Any] = (
            session.data_access_tracker.to_dict() if session.data_access_tracker is not None else {}
        )
        merged = {**existing_summary, **updates}
        db_session_model.data_access_summary = merged  # type: ignore
        db_session.commit()


class SessionTrackingMiddleware(Middleware):
    """
    Middleware that tracks tool call statistics for all mounted tools.

    This middleware intercepts every tool call and maintains per-session
    statistics accessible via contextvar.
    """

    def _get_or_create_session_stats(
        self,
        context: MiddlewareContext[mt.Request[Any, Any]],  # type: ignore
    ) -> tuple[MCPSession, str]:
        """Get or create session stats for the current connection.
        returns (session, session_id)"""

        # Get session ID from HTTP headers if available
        assert context.fastmcp_context is not None
        session_id = context.fastmcp_context.session_id

        # For debugging, let's log what we got
        log.debug(f"FastMCP context session_id: {context.fastmcp_context.session_id}")

        # Check if we already have a session for this user
        session = get_session_from_db(session_id)
        _ = current_session_id_ctxvar.set(session_id)
        return session, session_id

    # General hooks for on_request, on_message, etc.
    async def on_request(  # noqa
        self,
        context: MiddlewareContext[mt.Request[Any, Any]],  # type: ignore
        call_next: CallNext[mt.Request[Any, Any], Any],  # type: ignore
    ) -> Any:
        """
        Process the request and track tool calls.
        """
        # Get or create session stats
        _, _session_id = self._get_or_create_session_stats(context)

        try:
            return await call_next(context)  # type: ignore
        except SecurityError as e:
            # Avoid noisy tracebacks for expected security blocks
            log.warning(f"MCP request blocked by security policy: {e}")
            raise
        except ToolError as e:
            # Upstream tool failed; avoid noisy traceback here. Specific handlers may format a response.
            log.warning(f"MCP tool error: {e}")
            raise
        except Exception:
            log.exception("MCP request handling failed")
            raise

    # Hooks for Tools
    async def on_list_tools(  # noqa
        self,
        context: MiddlewareContext[Any],  # type: ignore
        call_next: CallNext[Any, Any],  # type: ignore
    ) -> Any:
        log.debug("🔍 on_list_tools")
        # Get the original response
        try:
            response = await call_next(context)
        except Exception:
            log.exception("MCP list_tools failed")
            raise
        log.debug("🔍 listed raw tools.")
        log.trace(f"🔍 on_list_tools response: length {len(response)}")

        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            raise ValueError("No session ID found in context")
        session = get_session_from_db(session_id)
        log.trace(f"Getting tool permissions for session {session_id}")
        assert session.data_access_tracker is not None

        # Filter out specific tools or return empty list
        allowed_tools: list[FunctionTool | ProxyTool | Any] = []
        perms = Permissions()
        for tool in response:
            # Due to proxy & server naming
            tool_name = tool.key
            log.trace(f"🔍 Processing tool listing {tool_name}")
            if isinstance(tool, FunctionTool):
                log.trace("🔍 Tool is built-in")
                log.trace(f"🔍 Tool is a FunctionTool: {tool}")
            elif isinstance(tool, ProxyTool):
                log.trace("🔍 Tool is a user-mounted tool")
                log.trace(f"🔍 Tool is a ProxyTool: {tool}")
            else:
                log.warning("🔍 Tool is of unknown type and will be disabled")
                log.trace(f"🔍 Tool is a unknown type: {tool}")
                continue

            log.trace(f"🔍 Getting permissions for tool {tool_name}")
            if perms.is_tool_enabled(tool_name):
                allowed_tools.append(tool)
            else:
                log.warning(
                    f"🔍 Tool {tool_name} is disabled or not configured and will not be allowed"
                )
                continue

        return allowed_tools  # type: ignore

    async def on_call_tool(  # noqa
        self,
        context: MiddlewareContext[mt.CallToolRequestParams],  # type: ignore
        call_next: CallNext[mt.CallToolRequestParams, ToolResult],  # type: ignore
    ) -> ToolResult:
        """Process tool calls and track security implications."""
        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            raise ValueError("No session ID found in context")
        session = get_session_from_db(session_id)
        log.trace(f"Adding tool call to session {session_id}")

        # Create new tool call
        new_tool_call = ToolCall(
            id=str(uuid.uuid4()),
            tool_name=context.message.name,
            parameters=context.message.arguments or {},
            timestamp=datetime.now(),
        )
        session.tool_calls.append(new_tool_call)

        assert session.data_access_tracker is not None
        log.debug(f"🔍 Analyzing tool {context.message.name} for security implications")
        try:
            session.data_access_tracker.add_tool_call(context.message.name)
        except SecurityError as e:
            # Publish pre-block event enriched with session_id then wait up to 30s for approval
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "tool",
                    "name": context.message.name,
                    "session_id": session_id,
                    "error": str(e),
                }
            )
            approved = await events.wait_for_approval(
                session_id, "tool", context.message.name, timeout_s=30.0
            )
            if not approved:
                # Return formatted SecurityError message (includes ASCII art)
                return ToolResult(
                    content=[
                        {
                            "type": "text",
                            "text": str(e),
                        }
                    ],
                    structured_content=None,
                )
            # Approved: apply effects and proceed
            session.data_access_tracker.apply_effects_after_manual_approval(
                "tool", context.message.name
            )
        # Telemetry: record tool call
        record_tool_call(context.message.name)

        # Persist the pending call immediately so it appears in UI
        _persist_session_to_db(session)

        log.trace(f"Tool call {context.message.name} added to session {session_id}")

        # Execute tool and update status/duration based on outcome
        start_time = time.perf_counter()
        try:
            result = await call_next(context)  # type: ignore
            new_tool_call.status = "ok"
            new_tool_call.duration_ms = (time.perf_counter() - start_time) * 1000.0

            _persist_session_to_db(session)

            return result
        except ToolError as e:
            new_tool_call.status = "error"
            new_tool_call.duration_ms = (time.perf_counter() - start_time) * 1000.0

            _persist_session_to_db(session)

            # Convert tool errors to a concise ToolResult rather than bubbling a stack trace
            log.warning(f"Tool failed: {context.message.name}: {e}")
            return ToolResult(
                content=[
                    {
                        "type": "text",
                        "text": (f"Tool '{context.message.name}' failed: {str(e)}"),
                    }
                ],
                structured_content=None,
            )
        except Exception:
            new_tool_call.status = "error"
            new_tool_call.duration_ms = (time.perf_counter() - start_time) * 1000.0

            _persist_session_to_db(session)
            raise

    # Hooks for Resources
    async def on_list_resources(  # noqa
        self,
        context: MiddlewareContext[Any],  # type: ignore
        call_next: CallNext[Any, Any],  # type: ignore
    ) -> Any:
        """Process resource access and track security implications."""
        log.trace("🔍 on_list_resources")
        # Get the original response
        try:
            response = await call_next(context)
        except Exception:
            log.exception("MCP list_resources failed")
            raise
        log.trace(f"🔍 on_list_resources response: length {len(response)}")

        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            raise ValueError("No session ID found in context")
        session = get_session_from_db(session_id)
        log.trace(f"Getting tool permissions for session {session_id}")
        assert session.data_access_tracker is not None

        # Filter out specific tools or return empty list
        allowed_resources: list[FunctionResource | ProxyResource | Any] = []
        perms = Permissions()
        for resource in response:
            resource_name = str(resource.uri)
            log.trace(f"🔍 Processing resource listing {resource_name}")
            if isinstance(resource, FunctionResource):
                log.trace("🔍 Resource is built-in")
                log.trace(f"🔍 Resource is a FunctionResource: {resource}")
            elif isinstance(resource, ProxyResource):
                log.trace("🔍 Resource is a user-mounted tool")
                log.trace(f"🔍 Resource is a ProxyResource: {resource}")
            else:
                log.warning("🔍 Resource is of unknown type and will be disabled")
                log.trace(f"🔍 Resource is a unknown type: {resource}")
                continue

            log.trace(f"🔍 Getting permissions for resource {resource_name}")
            if perms.is_resource_enabled(resource_name):
                allowed_resources.append(resource)
            else:
                log.warning(
                    f"🔍 Resource {resource_name} is disabled or not configured and will not be allowed"
                )
                continue

        return allowed_resources  # type: ignore

    async def on_read_resource(  # noqa
        self,
        context: MiddlewareContext[Any],  # type: ignore
        call_next: CallNext[Any, Any],  # type: ignore
    ) -> Any:
        """Process resource access and track security implications."""
        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            log.warning("No session ID found for resource access tracking")
            try:
                return await call_next(context)
            except Exception:
                log.exception("MCP read_resource failed")
                raise

        session = get_session_from_db(session_id)
        log.trace(f"Adding resource access to session {session_id}")
        assert session.data_access_tracker is not None

        # Get the resource name from the context
        resource_name = str(context.message.uri)

        log.debug(f"🔍 Analyzing resource {resource_name} for security implications")
        try:
            _ = session.data_access_tracker.add_resource_access(resource_name)
        except SecurityError as e:
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "resource",
                    "name": resource_name,
                    "session_id": session_id,
                    "error": str(e),
                }
            )
            approved = await events.wait_for_approval(
                session_id, "resource", resource_name, timeout_s=30.0
            )
            if not approved:
                return {
                    "type": "text",
                    "text": str(e),
                }
            session.data_access_tracker.apply_effects_after_manual_approval(
                "resource", resource_name
            )
        record_resource_used(resource_name)

        # Update database session
        with create_db_session() as db_session:
            db_session_model = db_session.execute(
                select(MCPSessionModel).where(MCPSessionModel.session_id == session_id)
            ).scalar_one()

            # Use helper to preserve created_at and merge updates
            existing_summary: dict[str, Any] = {}
            try:
                if isinstance(db_session_model.data_access_summary, dict):  # type: ignore
                    existing_summary = dict(db_session_model.data_access_summary)  # type: ignore
            except Exception:
                existing_summary = {}
            updates: dict[str, Any] = session.data_access_tracker.to_dict()
            merged: dict[str, Any] = {**existing_summary, **updates}
            db_session_model.data_access_summary = merged  # type: ignore
            db_session.commit()

        log.trace(f"Resource access {resource_name} added to session {session_id}")
        try:
            return await call_next(context)
        except Exception:
            log.exception("MCP read_resource failed")
            raise

    # Hooks for Prompts
    async def on_list_prompts(  # noqa
        self,
        context: MiddlewareContext[Any],  # type: ignore
        call_next: CallNext[Any, Any],  # type: ignore
    ) -> Any:
        """Process resource access and track security implications."""
        log.debug("🔍 on_list_prompts")
        # Get the original response
        try:
            response = await call_next(context)
        except Exception:
            log.exception("MCP list_prompts failed")
            raise
        log.debug(f"🔍 on_list_prompts response: length {len(response)}")

        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            raise ValueError("No session ID found in context")
        session = get_session_from_db(session_id)
        log.trace(f"Getting prompt permissions for session {session_id}")
        assert session.data_access_tracker is not None

        # Filter out specific tools or return empty list
        allowed_prompts: list[ProxyPrompt | Any] = []
        perms = Permissions()
        for prompt in response:
            prompt_name = str(prompt.name)
            log.trace(f"🔍 Processing prompt listing {prompt_name}")
            if isinstance(prompt, FunctionPrompt):
                log.trace("🔍 Prompt is built-in")
                log.trace(f"🔍 Prompt is a FunctionPrompt: {prompt}")
            elif isinstance(prompt, ProxyPrompt):
                log.trace("🔍 Prompt is a user-mounted tool")
                log.trace(f"🔍 Prompt is a ProxyPrompt: {prompt}")
            else:
                log.warning("🔍 Prompt is of unknown type and will be disabled")
                log.trace(f"🔍 Prompt is a unknown type: {prompt}")
                continue

            log.trace(f"🔍 Getting permissions for prompt {prompt_name}")
            if perms.is_prompt_enabled(prompt_name):
                allowed_prompts.append(prompt)
            else:
                log.warning(
                    f"🔍 Prompt {prompt_name} is disabled or not configured and will not be allowed"
                )
                continue

        return allowed_prompts  # type: ignore

    async def on_get_prompt(  # noqa
        self,
        context: MiddlewareContext[Any],  # type: ignore
        call_next: CallNext[Any, Any],  # type: ignore
    ) -> Any:
        """Process prompt access and track security implications."""
        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            log.warning("No session ID found for prompt access tracking")
            try:
                return await call_next(context)
            except Exception:
                log.exception("MCP get_prompt failed")
                raise

        session = get_session_from_db(session_id)
        log.trace(f"Adding prompt access to session {session_id}")
        assert session.data_access_tracker is not None

        prompt_name = context.message.name

        log.debug(f"🔍 Analyzing prompt {prompt_name} for security implications")
        try:
            _ = session.data_access_tracker.add_prompt_access(prompt_name)
        except SecurityError as e:
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "prompt",
                    "name": prompt_name,
                    "session_id": session_id,
                    "error": str(e),
                }
            )
            approved = await events.wait_for_approval(
                session_id, "prompt", prompt_name, timeout_s=30.0
            )
            if not approved:
                return {
                    "type": "text",
                    "text": str(e),
                }
            session.data_access_tracker.apply_effects_after_manual_approval("prompt", prompt_name)
        record_prompt_used(prompt_name)

        # Update database session
        with create_db_session() as db_session:
            db_session_model = db_session.execute(
                select(MCPSessionModel).where(MCPSessionModel.session_id == session_id)
            ).scalar_one()

            existing_summary = {}
            try:
                if isinstance(db_session_model.data_access_summary, dict):  # type: ignore
                    existing_summary = dict(db_session_model.data_access_summary)  # type: ignore
            except Exception:
                existing_summary = {}
            updates: dict[str, Any] = session.data_access_tracker.to_dict()
            merged: dict[str, Any] = {**existing_summary, **updates}
            db_session_model.data_access_summary = merged  # type: ignore
            db_session.commit()

        log.trace(f"Prompt access {prompt_name} added to session {session_id}")
        try:
            return await call_next(context)
        except Exception:
            log.exception("MCP get_prompt failed")
            raise
