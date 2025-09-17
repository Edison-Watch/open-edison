"""
Middleware to intercept DELETE requests to /mcp/ endpoint.

This middleware extracts the mcp-session-id from DELETE requests and
manages session continuity by mapping new session IDs to the deleted session ID.
"""

from collections.abc import Callable
from typing import Any

from fastapi import Request, Response
from loguru import logger as log
from starlette.middleware.base import BaseHTTPMiddleware

# Module-level variable to store OpenAI MCP session ID for session continuity
# This is simpler and more reliable than context variables across different middleware layers
_openai_mcp_session_id: str | None = None


def get_openai_mcp_session_id() -> str | None:
    """Get the current OpenAI MCP session ID from the module-level variable."""
    return _openai_mcp_session_id


def set_openai_mcp_session_id(session_id: str) -> None:
    """Set the OpenAI MCP session ID in the module-level variable."""
    global _openai_mcp_session_id
    _openai_mcp_session_id = session_id


# Add a FastAPI middleware to detect DELETE requests and notify the FastMCP DELETE interceptor
class OpenaiMcpSessionIdPatchMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Any]) -> Response:  # noqa
        if request.method == "DELETE" and request.url.path == "/mcp/":
            # Extract mcp-session-id from headers
            mcp_session_id = request.headers.get("mcp-session-id")
            user_agent = request.headers.get("user-agent")

            if mcp_session_id and user_agent and "openai-mcp" in user_agent:
                log.debug(
                    f'HTTP DELETE detected from agent "{user_agent}" with session ID: {mcp_session_id}'
                )
                # Set the session ID in the module-level variable
                current_value = get_openai_mcp_session_id()
                log.trace(f"Current module variable value: {current_value}")
                if current_value is None:
                    set_openai_mcp_session_id(mcp_session_id)
                    log.trace(
                        f"✅ OpenAI MCP user-agent detected, setting session ID: {mcp_session_id}"
                    )
                else:
                    log.trace(f"Module variable already set to: {current_value}, not overwriting")

        return await call_next(request)
