"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers using a unified composite proxy.
"""

from typing import Any, TypedDict

from fastmcp import Client as FastMCPClient
from fastmcp import Context
from loguru import logger as log

from src.config import MCPServerConfig, config
from src.middleware.session_tracking import (
    SessionTrackingMiddleware,
    get_current_session_data_tracker,
)
from src.oauth_manager import OAuthManager, OAuthStatus, get_oauth_manager
from src.permissions import (
    classify_tool_permissions_cached,
    clear_all_classify_permissions_caches,
    permissions,
)
from src.unmountable_fastmcp import UnmountableFastMCP


class ServerStatusInfo(TypedDict):
    """Type definition for server status information."""

    name: str
    config: dict[str, str | list[str] | bool | dict[str, str] | None]
    mounted: bool


class SingleUserMCP(UnmountableFastMCP):
    """
    Single-user MCP server implementation for Open Edison.

    This class extends UnmountableFastMCP to handle MCP protocol communication
    in a single-user environment using a unified composite proxy approach.
    All enabled MCP servers are mounted through a single UnmountableFastMCP composite proxy.
    """

    def __init__(self):
        super().__init__(name="open-edison-single-user")

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
        # For test servers, we just log that they're mounted since they don't need real proxies
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

        oauth_manager = get_oauth_manager()

        for server_config in enabled_servers:
            server_name = server_config.name

            # Skip if this server would produce an empty config (e.g., misconfigured)
            fastmcp_config = self._convert_to_fastmcp_config([server_config])
            if not fastmcp_config.get("mcpServers"):
                log.warning(f"Skipping server '{server_name}' due to empty MCP config")
                continue

            try:
                await self._mount_single_server(server_config, fastmcp_config, oauth_manager)
            except Exception as e:
                log.error(f"❌ Failed to mount server {server_name}: {e}")
                # Continue with other servers even if one fails
                continue

        log.info(f"✅ Created composite proxy with {len(enabled_servers)} servers")
        return True

    async def _mount_single_server(
        self,
        server_config: MCPServerConfig,
        fastmcp_config: dict[str, Any],
        oauth_manager: OAuthManager,
    ) -> None:
        """Mount a single MCP server with appropriate OAuth handling."""
        server_name = server_config.name

        # Check OAuth requirements for this server
        remote_url = server_config.get_remote_url()
        oauth_info = await oauth_manager.check_oauth_requirement(server_name, remote_url)

        # Create proxy based on server type to avoid union type issues
        if server_config.is_remote_server():
            # Handle remote servers (with or without OAuth)
            if not remote_url:
                log.error(f"❌ Remote server {server_name} has no URL")
                return

            if oauth_info.status == OAuthStatus.AUTHENTICATED:
                # Remote server with OAuth authentication
                oauth_auth = oauth_manager.get_oauth_auth(
                    server_name,
                    remote_url,
                    server_config.oauth_scopes,
                    server_config.oauth_client_name,
                )
                if oauth_auth:
                    client = FastMCPClient(remote_url, auth=oauth_auth)
                    log.info(
                        f"🔐 Created remote client with OAuth authentication for {server_name}"
                    )
                else:
                    client = FastMCPClient(remote_url)
                    log.warning(
                        f"⚠️ OAuth auth creation failed, using unauthenticated client for {server_name}"
                    )
            else:
                # Remote server without OAuth or needs auth
                client = FastMCPClient(remote_url)
                log.info(f"🌐 Created remote client for {server_name}")

            # Log OAuth status warnings
            if oauth_info.status == OAuthStatus.NEEDS_AUTH:
                log.warning(
                    f"⚠️ Server {server_name} requires OAuth but no valid tokens found. "
                    f"Server will be mounted without authentication and may fail."
                )
            elif oauth_info.status == OAuthStatus.ERROR:
                log.warning(f"⚠️ OAuth check failed for {server_name}: {oauth_info.error_message}")

            # Create proxy from remote client
            proxy = UnmountableFastMCP.as_proxy(client)

        else:
            # Local server - create proxy directly from config (avoids union type issue)
            log.info(f"🔧 Creating local process proxy for {server_name}")
            proxy = UnmountableFastMCP.as_proxy(fastmcp_config)

        self.mount(proxy, prefix=server_name)

        server_type = "remote" if server_config.is_remote_server() else "local"
        log.info(
            f"✅ Mounted {server_type} server {server_name} (OAuth: {oauth_info.status.value})"
        )

    async def get_mounted_servers(self) -> list[ServerStatusInfo]:
        """Get list of currently mounted servers."""
        # Use UnmountableFastMCP's list_mounted_servers method
        mounted_servers = self.list_mounted_servers()
        return [
            ServerStatusInfo(name=name or "unnamed", config={}, mounted=True)
            for name, _ in mounted_servers
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
        Reinitialize MCP servers by comparing current mounted servers with enabled config.

        This method:
        1. Reloads configuration and permissions
        2. Compares currently mounted servers with enabled servers in config
        3. Unmounts servers that are no longer enabled
        4. Mounts servers that are enabled but not currently mounted

        Args:
            test_config: Optional test configuration to use instead of reloading from disk

        Returns:
            Dictionary with reinitialization status and details
        """
        log.info("🔄 Reinitializing MCP servers based on configuration changes")

        try:
            # Step 1: Clear all permission caches
            log.info("Clearing all permission caches")
            clear_all_classify_permissions_caches()

            # Step 2: Reload configuration if not using test config
            config.reload()
            permissions.reload()

            # Step 3: Get current mounted servers
            current_mounted = self.list_mounted_servers()
            current_mounted_names = {name for name, _ in current_mounted if name}

            # Step 4: Get enabled servers from config
            enabled_servers = [s for s in config.mcp_servers if s.enabled]
            enabled_server_names = {s.name for s in enabled_servers}

            # Step 5: Determine which servers to unmount and mount
            servers_to_unmount = current_mounted_names - enabled_server_names
            servers_to_mount = enabled_server_names - current_mounted_names

            log.info(f"Current mounted servers: {list(current_mounted_names)}")
            log.info(f"Enabled servers in config: {list(enabled_server_names)}")
            log.info(f"Servers to unmount: {list(servers_to_unmount)}")
            log.info(f"Servers to mount: {list(servers_to_mount)}")

            # Step 6: Unmount servers that are no longer enabled
            unmounted_servers = []
            for server_name in servers_to_unmount:
                try:
                    success = self.unmount(server_name)
                    if success:
                        unmounted_servers.append(server_name)  # type: ignore
                        log.info(f"✅ Unmounted server: {server_name}")
                    else:
                        log.warning(f"⚠️ Failed to unmount server: {server_name}")
                except Exception as e:
                    log.error(f"❌ Error unmounting server {server_name}: {e}")

            # Step 7: Mount servers that are enabled but not currently mounted
            mounted_servers = []
            for server_name in servers_to_mount:
                try:
                    # Find the server config
                    server_config = next(
                        (s for s in enabled_servers if s.name == server_name), None
                    )
                    if server_config:
                        if server_config.command == "echo":
                            # Handle test servers
                            await self._mount_test_server(server_config)
                        else:
                            # Handle real servers
                            fastmcp_config = self._convert_to_fastmcp_config([server_config])
                            oauth_manager = get_oauth_manager()
                            await self._mount_single_server(
                                server_config, fastmcp_config, oauth_manager
                            )

                        mounted_servers.append(server_name)  # type: ignore
                        log.info(f"✅ Mounted server: {server_name}")
                    else:
                        log.warning(f"⚠️ Server config not found for: {server_name}")
                except Exception as e:
                    log.error(f"❌ Error mounting server {server_name}: {e}")

            # Step 8: Get final status
            final_mounted = await self.get_mounted_servers()

            result = {
                "status": "success",
                "message": "MCP servers reinitialized successfully",
                "unmounted_servers": unmounted_servers,
                "mounted_servers": mounted_servers,
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
            # Get mounted servers using UnmountableFastMCP's functionality
            mounted_servers = self.list_mounted_servers()
            server_names = [name for name, _ in mounted_servers if name]

            return {
                "name": "Open Edison Single User",
                "version": config.version,
                "mounted_servers": server_names,
                "total_mounted": len(server_names),
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

        @self.tool()
        async def get_available_tools() -> list[str]:
            """
            Get a list of all available tools. Use this tool to get an updated list of available tools.
            """
            tool_list = await self.get_tools()

            available_tools: list[str] = []
            for tool_name in tool_list:
                perms = classify_tool_permissions_cached(tool_name)
                if perms.get("enabled") and not perms.get("server_disabled"):
                    available_tools.append(tool_name)
            return available_tools

        @self.tool()
        async def tools_changed(ctx: Context) -> str:
            """
            Notify the MCP client that the tool list has changed. You should call this tool periodically
            to ensure the client has the latest list of available tools.
            """
            await ctx.send_tool_list_changed()
            await ctx.send_resource_list_changed()
            await ctx.send_prompt_list_changed()

            return "Notifications sent"

        log.info(
            "✅ Added built-in demo tools: echo, get_server_info, get_security_status, get_available_tools, tools_changed"
        )

    def _setup_demo_resources(self) -> None:
        """Set up built-in demo resources for testing."""

        @self.resource("config://app")
        def get_app_config() -> dict[str, Any]:  # noqa: ARG001
            """Get application configuration."""
            # Get mounted servers using UnmountableFastMCP's functionality
            mounted_servers = self.list_mounted_servers()
            server_names = [name for name, _ in mounted_servers if name]

            return {
                "version": config.version,
                "mounted_servers": server_names,
                "total_mounted": len(server_names),
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
