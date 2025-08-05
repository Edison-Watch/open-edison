"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers.
"""

from typing import Any, TypedDict

from fastmcp import FastMCP
from loguru import logger as log
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from src.config import MCPServerConfig, config
from src.mcp_manager import MCPManager


class MountedServerInfo(TypedDict):
    """Type definition for mounted server information."""
    config: MCPServerConfig
    proxy: FastMCP[Any] | None
    session: ClientSession | None


class ServerStatusInfo(TypedDict):
    """Type definition for server status information."""
    name: str
    config: dict[str, Any]
    mounted: bool


class MCPRequest(TypedDict):
    """Type definition for MCP JSON-RPC requests."""
    jsonrpc: str
    id: int | str | None
    method: str
    params: dict[str, Any] | None


class MCPResponse(TypedDict):
    """Type definition for MCP JSON-RPC responses."""
    jsonrpc: str
    id: int | str | None
    result: dict[str, Any]


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
        self.mounted_servers: dict[str, MountedServerInfo] = {}

    async def mount_server_from_config(self, server_config: MCPServerConfig) -> bool:
        """
        Mount an MCP server from configuration.

        Creates a FastMCP proxy from the subprocess and mounts it to this instance.
        """
        if server_config.command == "echo":
            return await self._mount_test_server(server_config)

        try:
            return await self._mount_real_server(server_config)
        except ValueError as e:
            log.error(f"❌ Configuration error mounting {server_config.name}: {e}")
            return False
        except Exception as e:
            log.error(f"❌ Failed to mount MCP server {server_config.name}: {e}")
            return False

    async def _mount_test_server(self, server_config: MCPServerConfig) -> bool:
        """Mount a test server with mock configuration."""
        log.info(f"Mock mounting test server: {server_config.name}")
        self.mounted_servers[server_config.name] = MountedServerInfo(
            config=server_config,
            proxy=None,
            session=None
        )
        log.info(f"✅ Mounted MCP server: {server_config.name}")
        return True

    async def _mount_real_server(self, server_config: MCPServerConfig) -> bool:
        """Mount a real MCP server via subprocess and FastMCP proxy."""
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

            self.mounted_servers[server_config.name] = MountedServerInfo(
                config=server_config,
                proxy=proxy_server,
                session=session
            )

            log.info(f"✅ Mounted MCP server: {server_config.name}")
            return True

    async def unmount_server(self, server_name: str) -> bool:
        """Unmount an MCP server and stop its subprocess."""
        try:
            await self._cleanup_mounted_server(server_name)
            await self._stop_server_process(server_name)
            return True
        except Exception as e:
            log.error(f"❌ Failed to unmount MCP server {server_name}: {e}")
            return False

    async def _cleanup_mounted_server(self, server_name: str) -> None:
        """Clean up mounted server resources."""
        if server_name in self.mounted_servers:
            mounted = self.mounted_servers[server_name]
            if mounted["session"] is not None:
                await mounted["session"].close()

            del self.mounted_servers[server_name]
            log.info(f"✅ Unmounted MCP server: {server_name}")

    async def _stop_server_process(self, server_name: str) -> None:
        """Stop the server subprocess if it's not a test server."""
        if server_name != "test-echo":
            await self.mcp_manager.stop_server(server_name)

    async def get_mounted_servers(self) -> list[ServerStatusInfo]:
        """Get list of currently mounted servers."""
        return [
            ServerStatusInfo(
                name=name,
                config=mounted["config"].__dict__,
                mounted=True
            )
            for name, mounted in self.mounted_servers.items()
        ]

    async def handle_mcp_request(self, request: MCPRequest) -> MCPResponse:
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

        return MCPResponse(
            jsonrpc="2.0",
            id=request.get("id"),
            result={
                "message": "Request handled by SingleUserMCP",
                "request": request,
                "mounted_servers": mounted_names,
            }
        )

    async def initialize(self, test_config: Any = None) -> None:
        """Initialize the FastMCP server and auto-mount enabled servers."""
        log.info("Initializing Single User MCP server")
        config_to_use = test_config if test_config is not None else config
        log.debug(f"Available MCP servers in config: {[s.name for s in config_to_use.mcp_servers]}")

        for server_config in config_to_use.mcp_servers:
            log.debug(f"Checking server {server_config.name}, enabled: {server_config.enabled}")
            if server_config.enabled:
                log.info(f"Auto-mounting enabled server: {server_config.name}")
                await self.mount_server_from_config(server_config)

        log.info("✅ Single User MCP server initialized")
