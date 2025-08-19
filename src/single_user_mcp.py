"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers using a unified composite proxy.
"""

from typing import Any, TypedDict

from fastmcp import Client as FastMCPClient
from fastmcp import FastMCP
from loguru import logger as log

from src.config import MCPServerConfig, config
from src.middleware.session_tracking import (
    SessionTrackingMiddleware,
    get_current_session_data_tracker,
)


class MountedServerInfo(TypedDict):
    """Type definition for mounted server information."""

    config: MCPServerConfig
    proxy: FastMCP[Any] | None


class ServerStatusInfo(TypedDict):
    """Type definition for server status information."""

    name: str
    config: dict[str, str | list[str] | bool | dict[str, str] | None]
    mounted: bool


class SingleUserMCP(FastMCP[Any]):
    """
    Single-user MCP server implementation for Open Edison.

    This class extends FastMCP to handle MCP protocol communication
    in a single-user environment using a unified composite proxy approach.
    All enabled MCP servers are mounted through a single FastMCP composite proxy.
    """

    def __init__(self):
        super().__init__(name="open-edison-single-user")
        self.mounted_servers: dict[str, MountedServerInfo] = {}
        self.composite_proxy: FastMCP[Any] | None = None

        # Add session tracking middleware for data access monitoring
        self.add_middleware(SessionTrackingMiddleware())

        # Add built-in demo tools
        self._setup_demo_tools()
        self._setup_demo_resources()
        self._setup_demo_prompts()

    def _convert_to_fastmcp_config(self, enabled_servers: list[MCPServerConfig]) -> dict[str, Any]:
        """
        Convert Open Edison config format to FastMCP MCPConfig format.

        Args:
            enabled_servers: List of enabled MCP server configurations

        Returns:
            Dictionary in FastMCP MCPConfig format for composite proxy
        """
        mcp_servers: dict[str, dict[str, Any]] = {}

        for server_config in enabled_servers:
            # Skip test servers for composite proxy
            if server_config.command == "echo":
                continue

            server_entry: dict[str, Any] = {
                "command": server_config.command,
                "args": server_config.args,
                "env": server_config.env or {},
            }

            # Add roots if specified
            if server_config.roots:
                server_entry["roots"] = server_config.roots

            mcp_servers[server_config.name] = server_entry

        return {"mcpServers": mcp_servers}

    async def _mount_test_server(self, server_config: MCPServerConfig) -> bool:
        """Mount a test server with mock configuration."""
        log.info(f"Mock mounting test server: {server_config.name}")
        self.mounted_servers[server_config.name] = MountedServerInfo(
            config=server_config, proxy=None
        )
        log.info(f"✅ Mounted test server: {server_config.name}")
        return True

    async def create_composite_proxy(self, enabled_servers: list[MCPServerConfig]) -> bool:
        """
        Create a unified composite proxy for all enabled MCP servers.

        This replaces individual server mounting with a single FastMCP composite proxy
        that handles all configured servers with automatic namespacing.

        Args:
            enabled_servers: List of enabled MCP server configurations

        Returns:
            True if composite proxy was created successfully, False otherwise
        """
        if not enabled_servers:
            log.info("No real servers to mount in composite proxy")
            return True

        # Import the composite proxy into this main server
        # Tools and resources will be automatically namespaced by server name
        for server_config in enabled_servers:
            server_name = server_config.name
            # Skip if this server would produce an empty config (e.g., misconfigured)
            fastmcp_config = self._convert_to_fastmcp_config([server_config])
            if not fastmcp_config.get("mcpServers"):
                log.warning(f"Skipping server '{server_name}' due to empty MCP config")
                continue
            proxy = FastMCP.as_proxy(FastMCPClient(fastmcp_config))
            self.mount(proxy, prefix=server_name)
            self.mounted_servers[server_name] = MountedServerInfo(config=server_config, proxy=proxy)

        log.info(
            f"✅ Created composite proxy with {len(enabled_servers)} servers ({self.mounted_servers.keys()})"
        )
        return True

    async def _rebuild_composite_proxy_without(self, excluded_server: str) -> bool:
        """Rebuild the composite proxy without the specified server."""
        try:
            # Remove from mounted servers
            await self._cleanup_mounted_server(excluded_server)

            # Get remaining servers that should be in composite proxy
            remaining_configs = [
                mounted["config"]
                for name, mounted in self.mounted_servers.items()
                if mounted["config"].command != "echo" and name != excluded_server
            ]

            if not remaining_configs:
                log.info("No servers remaining for composite proxy")
                self.composite_proxy = None
                return True

            # Rebuild composite proxy with remaining servers
            log.info(f"Rebuilding composite proxy without {excluded_server}")
            return await self.create_composite_proxy(remaining_configs)

        except Exception as e:
            log.error(f"Failed to rebuild composite proxy: {e}")
            return False

    async def _cleanup_mounted_server(self, server_name: str) -> None:
        """Clean up mounted server resources."""
        # TODO not sure this is possible for the self object? i.e. there is no self.unmount
        if server_name in self.mounted_servers:
            del self.mounted_servers[server_name]
            log.info(f"✅ Unmounted MCP server: {server_name}")

    async def get_mounted_servers(self) -> list[ServerStatusInfo]:
        """Get list of currently mounted servers."""
        return [
            ServerStatusInfo(name=name, config=mounted["config"].__dict__, mounted=True)
            for name, mounted in self.mounted_servers.items()
        ]

    async def initialize(self, test_config: Any | None = None) -> None:
        """Initialize the FastMCP server using unified composite proxy approach."""
        log.info("Initializing Single User MCP server with composite proxy")
        config_to_use = test_config if test_config is not None else config
        log.debug(f"Available MCP servers in config: {[s.name for s in config_to_use.mcp_servers]}")

        # Get all enabled servers
        enabled_servers = [s for s in config_to_use.mcp_servers if s.enabled]
        log.info(
            f"Found {len(enabled_servers)} enabled servers: {[s.name for s in enabled_servers]}"
        )

        # Mount test servers individually (they don't go in composite proxy)
        test_servers = [s for s in enabled_servers if s.command == "echo"]
        for server_config in test_servers:
            log.info(f"Mounting test server individually: {server_config.name}")
            _ = await self._mount_test_server(server_config)

        # Create composite proxy for all real servers
        success = await self.create_composite_proxy(enabled_servers)
        if not success:
            log.error("Failed to create composite proxy")
            return

        log.info("✅ Single User MCP server initialized with composite proxy")

    async def reinitialize(self, test_config: Any | None = None) -> dict[str, Any]:
        """
        Reinitialize all MCP servers by cleaning up existing ones and reloading config.

        This method:
        1. Cleans up all mounted servers and MCP proxies
        2. Reloads the configuration
        3. Reinitializes all enabled servers

        Args:
            test_config: Optional test configuration to use instead of reloading from disk

        Returns:
            Dictionary with reinitialization status and details
        """
        log.info("🔄 Reinitializing all MCP servers")

        try:
            # Step 1: Clean up existing mounted servers and proxies
            log.info("Cleaning up existing mounted servers and proxies")

            # Clean up composite proxy if it exists
            if self.composite_proxy is not None:
                log.info("Cleaning up composite proxy")
                self.composite_proxy = None

            # Clean up all mounted servers
            mounted_server_names = list(self.mounted_servers.keys())
            for server_name in mounted_server_names:
                await self._cleanup_mounted_server(server_name)

            # Clear the mounted servers dictionary completely
            self.mounted_servers.clear()

            log.info(f"✅ Cleaned up {len(mounted_server_names)} mounted servers")

            # Step 2: Reload configuration if not using test config
            config_to_use = test_config
            if test_config is None:
                log.info("Reloading configuration from disk")
                # Import here to avoid circular imports
                from src.config import Config

                config_to_use = Config.load()
                log.info("✅ Configuration reloaded from disk")

            # Step 3: Reinitialize all servers
            log.info("Reinitializing servers with fresh configuration")
            await self.initialize(config_to_use)

            # Step 4: Get final status
            final_mounted = await self.get_mounted_servers()

            result = {
                "status": "success",
                "message": "MCP servers reinitialized successfully",
                "cleaned_up_servers": mounted_server_names,
                "final_mounted_servers": [server["name"] for server in final_mounted],
                "total_final_mounted": len(final_mounted),
            }

            log.info(
                f"✅ Reinitialization complete. Final mounted servers: {result['final_mounted_servers']}"
            )
            return result

        except Exception as e:
            log.error(f"❌ Failed to reinitialize MCP servers: {e}")
            return {
                "status": "error",
                "message": f"Failed to reinitialize MCP servers: {str(e)}",
                "error": str(e),
            }

    def _calculate_risk_level(self, trifecta: dict[str, bool]) -> str:
        """
        Calculate a human-readable risk level based on trifecta flags.

        Args:
            trifecta: Dictionary with the three trifecta flags

        Returns:
            Risk level as string
        """
        risk_count = sum(
            [
                trifecta.get("has_private_data_access", False),
                trifecta.get("has_untrusted_content_exposure", False),
                trifecta.get("has_external_communication", False),
            ]
        )

        risk_levels = {
            0: "LOW",
            1: "MEDIUM",
            2: "HIGH",
        }
        return risk_levels.get(risk_count, "CRITICAL")

    def _setup_demo_tools(self) -> None:
        """Set up built-in demo tools for testing."""

        @self.tool()
        def echo(text: str) -> str:  # noqa: ARG001
            """
            Echo back the provided text.

            Args:
                text: The text to echo back

            Returns:
                The same text that was provided
            """
            log.info(f"🔊 Echo tool called with: {text}")
            return f"Echo: {text}"

        @self.tool()
        def get_server_info() -> dict[str, str | list[str] | int]:  # noqa: ARG001
            """
            Get information about the Open Edison server.

            Returns:
                Dictionary with server information
            """
            log.info("ℹ️  Server info tool called")
            return {
                "name": "Open Edison Single User",
                "version": config.version,
                "mounted_servers": list(self.mounted_servers.keys()),
                "total_mounted": len(self.mounted_servers),
            }

        @self.tool()
        def get_security_status() -> dict[str, Any]:  # noqa: ARG001
            """
            Get the current session's security status and data access summary.

            Returns:
                Dictionary with security information including lethal trifecta status
            """
            log.info("🔒 Security status tool called")

            tracker = get_current_session_data_tracker()
            if tracker is None:
                return {"error": "No active session found", "security_status": "unknown"}

            security_data = tracker.to_dict()
            trifecta = security_data["lethal_trifecta"]

            # Add human-readable status
            security_data["security_status"] = (
                "HIGH_RISK" if trifecta["trifecta_achieved"] else "MONITORING"
            )
            security_data["risk_level"] = self._calculate_risk_level(trifecta)

            return security_data

        log.info("✅ Added built-in demo tools: echo, get_server_info, get_security_status")

    def _setup_demo_resources(self) -> None:
        """Set up built-in demo resources for testing."""

        @self.resource("config://app")
        def get_app_config() -> dict[str, Any]:  # noqa: ARG001
            """Get application configuration."""
            return {
                "version": config.version,
                "mounted_servers": list(self.mounted_servers.keys()),
                "total_mounted": len(self.mounted_servers),
            }

        log.info("✅ Added built-in demo resources: config://app")

    def _setup_demo_prompts(self) -> None:
        """Set up built-in demo prompts for testing."""

        @self.prompt()
        def summarize_text(text: str) -> str:
            """Create a prompt to summarize the given text."""
            return f"""
        Please provide a concise, one-paragraph summary of the following text:

        {text}

        Focus on the main points and key takeaways.
        """

        log.info("✅ Added built-in demo prompts: summarize_text")
