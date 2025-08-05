"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers.
"""

from typing import Any

from fastmcp import FastMCP
from loguru import logger as log

from src.config import config
from src.mcp_manager import MCPManager


class SingleUserMCP(FastMCP):
    """
    Single-user FastMCP server instance.

    This handles the MCP protocol communication and integrates with
    the MCP manager for subprocess control.
    """

    def __init__(self, mcp_manager: MCPManager):
        super().__init__()
        self.mcp_manager = mcp_manager

    async def handle_mcp_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """
        Handle an MCP protocol request.

        For now, this is a placeholder that would integrate with the
        running MCP server subprocesses managed by MCPManager.
        """
        # TODO: Implement actual MCP request routing to subprocess servers
        # This will involve:
        # 1. Parsing the request to determine which server it's for
        # 2. Forwarding to the appropriate subprocess via stdio
        # 3. Returning the response

        log.info(f"Handling MCP request: {request.get('method', 'unknown')}")

        # Placeholder response
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "message": "MCP request handling not yet implemented",
                "request": request,
                "available_servers": [
                    server.name for server in config.mcp_servers if server.enabled
                ],
            },
        }

    async def initialize(self) -> None:
        """Initialize the FastMCP server with any needed setup."""
        log.info("Initializing Single User MCP server")

        # TODO: Set up any FastMCP-specific configuration
        # TODO: Register tools/resources from enabled MCP servers

        log.info("✅ Single User MCP server initialized")
