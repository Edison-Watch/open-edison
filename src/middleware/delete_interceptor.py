"""
Middleware to intercept DELETE requests to /mcp/ endpoint.

This middleware extracts the mcp-session-id from DELETE requests and
manages session continuity by mapping new session IDs to the deleted session ID.
"""

from contextvars import ContextVar
from typing import Any

import mcp.types as mt
from fastmcp.server.middleware import Middleware
from fastmcp.server.middleware.middleware import CallNext, MiddlewareContext
from loguru import logger as log

# Context variable to store session ID mapping
session_id_mapping_ctxvar: ContextVar[str | None] = ContextVar[str | None](
    "session_id_mapping", default=None
)


class DeleteInterceptorMiddleware(Middleware):
    """
    Middleware to intercept DELETE requests to /mcp/ endpoint.

    This middleware:
    - Extracts mcp-session-id from DELETE request headers
    - Stores the session ID for future session continuity
    - Maps new session IDs to the deleted session ID
    - Maintains session continuity across DELETE operations
    """

    def __init__(self):
        super().__init__()
        # Store the original session ID for continuity (first DELETE call)
        self._original_session_id: str | None = None

    async def on_request(  # noqa
        self,
        context: MiddlewareContext[mt.Request[Any, Any]],  # type: ignore
        call_next: CallNext[mt.Request[Any, Any], Any],  # type: ignore
    ) -> Any:
        """
        Intercept MCP requests and manage session continuity for DELETE operations.

        This middleware runs BEFORE SessionTrackingMiddleware and handles session
        continuity by detecting when sessions are being "deleted" and mapping
        new session IDs to the original session ID.

        Args:
            context: The FastMCP middleware context
            call_next: The next middleware/handler in the chain

        Returns:
            Response from the next handler
        """
        # Get the FastMCP context to access session information
        assert context.fastmcp_context is not None
        current_session_id = context.fastmcp_context.session_id

        log.trace(f"DeleteInterceptor processing request with session ID: {current_session_id}")

        # Check if we have a session ID mapping from a previous DELETE operation
        if self._original_session_id:
            # Always set the mapping for any request after a DELETE operation
            # This ensures session continuity regardless of whether the session ID changed
            log.debug(
                f"Applying session continuity: {current_session_id} -> {self._original_session_id}"
            )

            # Set the session ID mapping in the context variable
            # This will be picked up by the session tracking middleware
            session_id_mapping_ctxvar.set(self._original_session_id)

        # Process the request
        try:
            return await call_next(context)
        except Exception as e:
            log.error(f"Error processing request in DeleteInterceptor: {e}")
            raise

    def handle_delete_operation(self, session_id: str) -> None:
        """
        Handle a DELETE operation by storing the session ID for future continuity.

        This method should be called when a DELETE request is detected at the HTTP level.

        Args:
            session_id: The session ID from the DELETE request
        """
        if session_id:
            # Store the original session ID only if we don't have one yet
            if self._original_session_id is None:
                self._original_session_id = session_id
                log.trace(f"Stored original session ID {session_id} for future session continuity")
            else:
                log.trace(
                    f"DELETE operation with session ID {session_id}, but maintaining original session ID {self._original_session_id}"
                )

            # Immediately set the mapping for any pending requests
            session_id_mapping_ctxvar.set(self._original_session_id)
            log.debug(f"Creating session mapping: {session_id} -> {self._original_session_id}")
        else:
            log.warning("⚠️ No session ID provided for DELETE operation")

    def clear_session_mapping(self) -> None:
        """Clear the session mapping and reset state."""
        if self._original_session_id or session_id_mapping_ctxvar.get():
            self._original_session_id = None
            session_id_mapping_ctxvar.set(None)
            log.info("🔄 Session mapping cleared")
