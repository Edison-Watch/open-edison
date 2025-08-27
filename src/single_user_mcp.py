"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers using a unified composite proxy.
"""

from typing import Any, TypedDict

from fastmcp import Client as FastMCPClient
from fastmcp import Context, FastMCP
from loguru import logger as log

from src.config import Config, MCPServerConfig
from src.middleware.session_tracking import (
    SessionTrackingMiddleware,
    get_current_session_data_tracker,
)
from src.oauth_manager import OAuthManager, OAuthStatus, get_oauth_manager
from src.permissions import Permissions, PermissionsError


class MountedServerInfo(TypedDict):
    """Type definition for mounted server information."""

    config: MCPServerConfig  # noqa
    proxy: FastMCP[Any] | None


class ServerStatusInfo(TypedDict):
    """Type definition for server status information."""

    name: str
    config: dict[str, str | list[str] | bool | dict[str, str] | None]  # noqa
    mounted: bool


# Module level because needs to be read by permissions etc
mounted_servers: dict[str, MountedServerInfo] = {}


class SingleUserMCP(FastMCP[Any]):
    """
    Single-user MCP server implementation for Open Edison.

    This class extends FastMCP to handle MCP protocol communication
    in a single-user environment using a unified composite proxy approach.
    All enabled MCP servers are mounted through a single FastMCP composite proxy.
    """

    def __init__(self):
        # Disable error masking so upstream error details are preserved in responses
        super().__init__(name="open-edison-single-user", mask_error_details=False)

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

        log.info(
            f"✅ Created composite proxy with {len(enabled_servers)} servers ({mounted_servers.keys()})"
        )
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
            proxy = FastMCP.as_proxy(client)

        else:
            # Local server - create proxy directly from config (avoids union type issue)
            log.info(f"🔧 Creating local process proxy for {server_name}")
            proxy = FastMCP.as_proxy(fastmcp_config)

        super().mount(proxy, prefix=server_name)
        mounted_servers[server_name] = MountedServerInfo(config=server_config, proxy=proxy)

        server_type = "remote" if server_config.is_remote_server() else "local"
        log.info(
            f"✅ Mounted {server_type} server {server_name} (OAuth: {oauth_info.status.value})"
        )

    async def get_mounted_servers(self) -> list[ServerStatusInfo]:
        """Get list of currently mounted servers."""
        return [
            ServerStatusInfo(name=name, config=mounted["config"].__dict__, mounted=True)
            for name, mounted in mounted_servers.items()
        ]

    async def mount_server(self, server_name: str) -> bool:
        """
        Mount a server by name if not already mounted.

        Returns True if newly mounted, False if it was already mounted or failed.
        """
        if server_name in mounted_servers:
            log.info(f"🔁 Server {server_name} already mounted")
            return False

        # Find server configuration
        server_config: MCPServerConfig | None = next(
            (s for s in Config().mcp_servers if s.name == server_name), None
        )

        if server_config is None:
            log.error(f"❌ Server configuration not found: {server_name}")
            return False

        # Build minimal FastMCP backend config for just this server
        fastmcp_config = self._convert_to_fastmcp_config([server_config])
        if not fastmcp_config.get("mcpServers"):
            log.error(f"❌ Invalid/empty MCP config for server: {server_name}")
            return False

        try:
            oauth_manager = get_oauth_manager()
            await self._mount_single_server(server_config, fastmcp_config, oauth_manager)
            # Warm lists after mount
            _ = await self._tool_manager.list_tools()
            _ = await self._resource_manager.list_resources()
            _ = await self._prompt_manager.list_prompts()
            return True
        except Exception as e:  # noqa: BLE001
            log.error(f"❌ Failed to mount server {server_name}: {e}")
            return False

    async def unmount(self, server_name: str) -> bool:
        """
        Unmount a previously mounted server by name.

        Returns True if it was unmounted, False if it wasn't mounted.
        """
        info = mounted_servers.pop(server_name, None)
        if info is None:
            log.info(f"ℹ️  Server {server_name} was not mounted")
            return False

        proxy = info.get("proxy")

        # Manually remove from FastMCP managers' mounted lists
        for manager_name in ("_tool_manager", "_resource_manager", "_prompt_manager"):
            manager = getattr(self, manager_name, None)
            mounted_list = getattr(manager, "_mounted_servers", None)
            if mounted_list is None:
                continue

            # Prefer removing by both prefix and object identity; fallback to prefix-only
            new_list = [
                m
                for m in mounted_list
                if not (m.prefix == server_name and (proxy is None or m.server is proxy))
            ]
            if len(new_list) == len(mounted_list):
                new_list = [m for m in mounted_list if m.prefix != server_name]

            mounted_list[:] = new_list

        # Invalidate and warm lists to ensure reload
        _ = await self._tool_manager.list_tools()
        _ = await self._resource_manager.list_resources()
        _ = await self._prompt_manager.list_prompts()

        log.info(f"🧹 Unmounted server {server_name} and cleared references")
        return True

    async def initialize(self) -> None:
        """Initialize the FastMCP server using unified composite proxy approach."""
        log.info("Initializing Single User MCP server with composite proxy")
        log.debug(f"Available MCP servers in config: {[s.name for s in Config().mcp_servers]}")

        # Get all enabled servers
        enabled_servers = [s for s in Config().mcp_servers if s.enabled]
        log.info(
            f"Found {len(enabled_servers)} enabled servers: {[s.name for s in enabled_servers]}"
        )

        # Unmount all servers
        for server_name in list(mounted_servers.keys()):
            await self.unmount(server_name)

        # Create composite proxy for all real servers
        success = await self.create_composite_proxy(enabled_servers)
        if not success:
            log.error("Failed to create composite proxy")
            return

        log.info("✅ Single User MCP server initialized with composite proxy")

        # Invalidate and warm lists to ensure reload
        _ = await self._tool_manager.list_tools()
        _ = await self._resource_manager.list_resources()
        _ = await self._prompt_manager.list_prompts()

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

        @self.tool()  # noqa
        def builtin_echo(text: str) -> str:
            """
            Echo back the provided text.

            Args:
                text: The text to echo back

            Returns:
                The same text that was provided
            """
            log.info(f"🔊 Echo tool called with: {text}")
            return f"Echo: {text}"

        @self.tool()  # noqa
        def builtin_get_server_info() -> dict[str, str | list[str] | int]:
            """
            Get information about the Open Edison server.

            Returns:
                Dictionary with server information
            """
            log.info("ℹ️  Server info tool called")
            return {
                "name": "Open Edison Single User",
                "version": Config().version,
                "mounted_servers": list(mounted_servers.keys()),
                "total_mounted": len(mounted_servers),
            }

        @self.tool()  # noqa
        def builtin_get_security_status() -> dict[str, Any]:
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

        @self.tool()  # noqa
        async def builtin_get_available_tools() -> list[str]:
            """
            Get a list of all available tools. Use this tool to get an updated list of available tools.
            """
            tool_list = await self._tool_manager.list_tools()
            available_tools: list[str] = []
            log.trace(f"Raw tool list: {tool_list}")
            perms = Permissions()
            for tool in tool_list:
                # Use the prefixed key (e.g., "filesystem_read_file") to match flattened permissions
                perm_key = tool.key
                try:
                    is_enabled: bool = perms.is_tool_enabled(perm_key)
                except PermissionsError:
                    # Unknown in permissions → treat as disabled
                    is_enabled = False
                if is_enabled:
                    # Return the invocable name (key), which matches the MCP-exposed name
                    available_tools.append(tool.key)
            return available_tools

        @self.tool()  # noqa
        async def builtin_tools_changed(ctx: Context) -> str:
            """
            Notify the MCP client that the tool list has changed. You should call this tool periodically
            to ensure the client has the latest list of available tools.
            """
            await ctx.send_tool_list_changed()
            await ctx.send_resource_list_changed()
            await ctx.send_prompt_list_changed()

            return "Notifications sent"

        log.info(
            "✅ Added built-in demo tools: echo, get_server_info, get_security_status, builtin_get_available_tools, builtin_tools_changed"
        )

    def _setup_demo_resources(self) -> None:
        """Set up built-in demo resources for testing."""

        @self.resource("config://app")  # noqa
        def builtin_get_app_config() -> dict[str, Any]:
            """Get application configuration."""
            return {
                "version": Config().version,
                "mounted_servers": list(mounted_servers.keys()),
                "total_mounted": len(mounted_servers),
            }

        log.info("✅ Added built-in demo resources: config://app")

    def _setup_demo_prompts(self) -> None:
        """Set up built-in demo prompts for testing."""

        @self.prompt()  # noqa
        def builtin_summarize_text(text: str) -> str:
            """Create a prompt to summarize the given text."""
            return f"""
        Please provide a concise, one-paragraph summary of the following text:

        {text}

        Focus on the main points and key takeaways.
        """

        log.info("✅ Added built-in demo prompts: summarize_text")
