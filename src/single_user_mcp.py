"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers.
"""

from typing import Any

from fastmcp import FastMCP
from loguru import logger as log
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from src.config import MCPServerConfig, config
from src.mcp_manager import MCPManager


class SingleUserMCP(FastMCP[Any]):
    """
    Single-user MCP server implementation for Open Edison.

    This class extends FastMCP to handle MCP protocol communication
    in a single-user environment. It manages the lifecycle of MCP servers
    and provides a unified interface for MCP operations.
    """

    def __init__(self, mcp_manager: MCPManager):
        super().__init__(name="open-edison-single-user")
        self.mcp_manager = mcp_manager
        self.mounted_servers: dict[str, Any] = {}

    async def mount_server_from_config(self, server_config: MCPServerConfig) -> bool:
        """
        Mount an MCP server from configuration.

        Creates a FastMCP proxy from the subprocess and mounts it to this instance.
        """
        try:
            if not await self.mcp_manager.is_server_running(server_config.name):
                await self.mcp_manager.start_server(server_config.name)

            process = self.mcp_manager.processes.get(server_config.name)
            if not process:
                raise ValueError(f"Failed to get process for {server_config.name}")

            server_params = StdioServerParameters(
                command=server_config.command,
                args=server_config.args,
                env=server_config.env or {}
            )

            async with stdio_client(server_params) as (read, write):
                session = ClientSession(read, write)
                await session.initialize()

                proxy_server = FastMCP.as_proxy(session, name=server_config.name)

                await self.import_server(proxy_server, prefix=server_config.name)

                self.mounted_servers[server_config.name] = {
                    "config": server_config,
                    "proxy": proxy_server,
                    "session": session
                }

                log.info(f"✅ Mounted MCP server: {server_config.name}")
                return True

        except Exception as e:
            log.error(f"❌ Failed to mount MCP server {server_config.name}: {e}")
            return False

    async def unmount_server(self, server_name: str) -> bool:
        """Unmount an MCP server and stop its subprocess."""
        try:
            if server_name in self.mounted_servers:
                mounted = self.mounted_servers[server_name]
                if "session" in mounted:
                    await mounted["session"].close()

                del self.mounted_servers[server_name]

                log.info(f"✅ Unmounted MCP server: {server_name}")

            await self.mcp_manager.stop_server(server_name)
            return True

        except Exception as e:
            log.error(f"❌ Failed to unmount MCP server {server_name}: {e}")
            return False

    async def get_mounted_servers(self) -> list[dict[str, Any]]:
        """Get list of currently mounted servers."""
        return [
            {
                "name": name,
                "config": mounted["config"].__dict__,
                "mounted": True
            }
            for name, mounted in self.mounted_servers.items()
        ]

    async def handle_mcp_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """
        Handle incoming MCP requests.

        Args:
            request: The MCP request to handle

        Returns:
            The response from the appropriate MCP server
        """
        log.debug(f"Handling MCP request: {request}")

        mounted = await self.get_mounted_servers()
        mounted_names = [server["name"] for server in mounted]

        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "message": "Request handled by SingleUserMCP",
                "request": request,
                "mounted_servers": mounted_names,
            },
        }

    async def initialize(self) -> None:
        """Initialize the FastMCP server and auto-mount enabled servers."""
        log.info("Initializing Single User MCP server")

        for server_config in config.mcp_servers:
            if server_config.enabled:
                log.info(f"Auto-mounting enabled server: {server_config.name}")
                await self.mount_server_from_config(server_config)

        log.info("✅ Single User MCP server initialized")
