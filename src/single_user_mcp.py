"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers using a unified composite proxy.
"""

import asyncio
import time
from typing import Any, TypedDict

from fastmcp import Client as FastMCPClient
from fastmcp import Context, FastMCP
from fastmcp.server.server import add_resource_prefix, has_resource_prefix

# Low level FastMCP imports
from fastmcp.tools.tool import Tool
from fastmcp.tools.tool_transform import (
    apply_transformations_to_tools,
)
from loguru import logger as log
from mcp.server.lowlevel.server import LifespanResultT

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

    async def import_server(
        self,
        server: FastMCP[LifespanResultT],
        prefix: str | None = None,
        tool_separator: str | None = None,
        resource_separator: str | None = None,
        prompt_separator: str | None = None,
    ) -> None:
        """
        Import the MCP objects from another FastMCP server into this one with a given prefix.
        Overloads FastMCP's import_server method to improve performance.

        Args:
            server: The FastMCP server to import
            prefix: prefix to use for the imported server's objects. If None,
                objects are imported with their original names.
            tool_separator: Deprecated. Required to be None.
            resource_separator: Deprecated. Required to be None.
            prompt_separator: Deprecated. Required to be None.
        """

        if prefix is None:
            raise ValueError("Prefix is required")

        if tool_separator is not None:
            raise ValueError("Tool separator is deprecated and not supported")

        if resource_separator is not None:
            raise ValueError("Resource separator is deprecated and not supported")

        if prompt_separator is not None:
            raise ValueError("Prompt separator is deprecated and not supported")

        log.debug(f"🔧 Importing server {prefix} ({server.name}) into single user MCP'")

        # Fetch all server objects in parallel
        tools, resources, templates, prompts = await asyncio.gather(
            server.get_tools(),
            server.get_resources(),
            server.get_resource_templates(),
            server.get_prompts(),
            return_exceptions=True,
        )

        # Validate and normalize all results
        tools = self._validate_server_result(tools, "tools", server.name)
        resources = self._validate_server_result(resources, "resources", server.name)
        templates = self._validate_server_result(templates, "templates", server.name)
        prompts = self._validate_server_result(prompts, "prompts", server.name)

        # Import all components
        self._import_tools(tools, prefix)
        self._import_resources(resources, prefix)
        self._import_templates(templates, prefix)
        self._import_prompts(prompts, prefix)

        log.debug(f"Imported server {server.name} with prefix '{prefix}'")

    def _validate_server_result(
        self, result: Any, result_type: str, server_name: str
    ) -> dict[str, Any]:
        """Validate and normalize server result from asyncio.gather with return_exceptions=True."""
        if isinstance(result, Exception):
            log.warning(f'Server {server_name} does not appear to contain "{result_type}"')
            log.debug(f"Server {server_name} _validate_server_result exception result: {result}")
            return {}
        if not isinstance(result, dict):
            log.warning(f"Server {server_name} returned an unexpected response")
            log.debug(
                f"Server {server_name} _validate_server_result unexpected type {type(result)} with value: {result}"
            )
            return {}
        return result  # type: ignore[return-value]

    def _import_tools(self, tools: dict[str, Any], prefix: str) -> None:
        """Import tools from server"""
        for key, tool in tools.items():
            if prefix:
                tool = tool.model_copy(key=f"{prefix}_{key}")
            self._tool_manager.add_tool(tool)

    def _import_resources(self, resources: dict[str, Any], prefix: str) -> None:
        """Import resources from server"""
        for key, resource in resources.items():
            if prefix:
                resource_key = add_resource_prefix(key, prefix, self.resource_prefix_format)
                resource = resource.model_copy(
                    update={"name": f"{prefix}_{resource.name}"}, key=resource_key
                )
            self._resource_manager.add_resource(resource)

    def _import_templates(self, templates: dict[str, Any], prefix: str) -> None:
        """Import templates from server"""
        for key, template in templates.items():
            if prefix:
                template_key = add_resource_prefix(key, prefix, self.resource_prefix_format)
                template = template.model_copy(
                    update={"name": f"{prefix}_{template.name}"}, key=template_key
                )
            self._resource_manager.add_template(template)

    def _import_prompts(self, prompts: dict[str, Any], prefix: str) -> None:
        """Import prompts from server"""
        for key, prompt in prompts.items():
            if prefix:
                prompt = prompt.model_copy(key=f"{prefix}_{key}")
            self._prompt_manager.add_prompt(prompt)

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

        client_timeout = 10
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
                    client = FastMCPClient(
                        remote_url,
                        auth=oauth_auth,
                        timeout=client_timeout,
                    )
                    log.info(
                        f"🔐 Created remote client with OAuth authentication for {server_name}"
                    )
                else:
                    client = FastMCPClient(remote_url, timeout=client_timeout)
                    log.warning(
                        f"⚠️ OAuth auth creation failed, using unauthenticated client for {server_name}"
                    )
            else:
                # Remote server without OAuth or needs auth
                client = FastMCPClient(remote_url, timeout=client_timeout)
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
            log.debug(f"🔧 Creating local process proxy for {server_name}")
            proxy = FastMCP.as_proxy(fastmcp_config)

        log.debug(f"🔧 Importing server {server_name} into single user MCP")
        await self.import_server(proxy, prefix=server_name)
        # await super().import_server(proxy, prefix=server_name)
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

        # Remove the server from mounted_servers lists in all managers
        for manager_name in ("_tool_manager", "_resource_manager", "_prompt_manager"):
            manager = getattr(self, manager_name, None)
            if manager is None:
                continue
            mounted_list = getattr(manager, "_mounted_servers", None)
            if mounted_list is None:
                continue

            # Remove servers with matching prefix
            mounted_list[:] = [m for m in mounted_list if m.prefix != server_name]

        # Remove tools with matching prefix (server name)
        self._tool_manager._tools = {  # type: ignore
            key: value
            for key, value in self._tool_manager._tools.items()  # type: ignore
            if not key.startswith(f"{server_name}_")
        }

        # Remove transformations with matching prefix (server name)
        self._tool_manager.transformations = {  # type: ignore
            key: value
            for key, value in self._tool_manager.transformations.items()  # type: ignore
            if not key.startswith(f"{server_name}_")
        }

        # Remove resources with matching prefix (server name)
        self._resource_manager._resources = {  # type: ignore
            key: value
            for key, value in self._resource_manager._resources.items()  # type: ignore
            if not has_resource_prefix(key, server_name, self.resource_prefix_format)  # type: ignore
        }

        # Remove templates with matching prefix (server name)
        self._resource_manager._templates = {  # type: ignore
            key: value
            for key, value in self._resource_manager._templates.items()  # type: ignore
            if not has_resource_prefix(key, server_name, self.resource_prefix_format)  # type: ignore
        }

        # Remove prompts with matching prefix (server name)
        self._prompt_manager._prompts = {  # type: ignore
            key: value
            for key, value in self._prompt_manager._prompts.items()  # type: ignore
            if not key.startswith(f"{server_name}_")
        }

        log.info(f"🧹 Unmounted server {server_name} and cleared references")
        return True

    async def list_all_servers_tools_parallel(self) -> list[Tool]:
        """Reload all servers' tools in parallel.
        Reimplements FastMCP's ToolManager._list_tools method with parallel execution.
        """

        # Execute all server reloads in parallel
        list_tasks = [
            server.server._list_tools()
            for server in self._tool_manager._mounted_servers  # type: ignore
        ]

        log.debug(f"Starting reload for {len(list_tasks)} servers' tools in parallel")
        start_time = time.perf_counter()
        all_tools: dict[str, Tool] = {}
        if list_tasks:
            # Use return_exceptions=True to prevent one failing server from breaking everything
            tools_lists = await asyncio.gather(*list_tasks, return_exceptions=True)
            for server, tools_result in zip(
                self._tool_manager._mounted_servers,  # type: ignore
                tools_lists,
                strict=False,
            ):
                if isinstance(tools_result, Exception):
                    log.warning(f"Failed to get tools from server {server.prefix}: {tools_result}")
                    continue

                tools_list = tools_result
                if not tools_list or not isinstance(tools_list, list):
                    continue

                tools_dict = {t.key: t for t in tools_list}  # type: ignore
                if server.prefix:
                    for tool in tools_dict.values():
                        prefixed_tool = tool.model_copy(  # type: ignore
                            key=f"{server.prefix}_{tool.key}"  # type: ignore
                        )
                        all_tools[prefixed_tool.key] = prefixed_tool  # type: ignore
                else:
                    all_tools.update(tools_dict)  # type: ignore
            log.debug(
                f"Saved {len(all_tools)} tools from {len([r for r in tools_lists if not isinstance(r, Exception)])} servers"
            )
        else:
            all_tools = {}

        # Add local tools
        all_tools.update(self._tool_manager._tools)  # type: ignore

        transformed_tools = apply_transformations_to_tools(
            tools=all_tools,
            transformations=self._tool_manager.transformations,
        )

        final_tools_list = list(transformed_tools.values())

        end_time = time.perf_counter()
        log.debug(f"Time taken to reload all servers' tools: {end_time - start_time:.1f} seconds")
        return final_tools_list

    async def initialize(self) -> None:
        """Initialize the FastMCP server using unified composite proxy approach."""
        log.info("Initializing Single User MCP server with composite proxy")
        log.debug(f"Available MCP servers in config: {[s.name for s in Config().mcp_servers]}")
        start_time = time.perf_counter()
        # Get all enabled servers
        enabled_servers = [s for s in Config().mcp_servers if s.enabled]
        log.info(
            f"Found {len(enabled_servers)} enabled servers: {[s.name for s in enabled_servers]}"
        )

        # Figure out which servers are to be unmounted
        enabled_server_names = {s.name for s in enabled_servers}
        servers_to_unmount = [s for s in mounted_servers if s not in enabled_server_names]

        # Figure out which servers are to be mounted
        servers_to_mount = [s.name for s in enabled_servers if s.name not in mounted_servers]

        # Unmount those servers (quick)
        for server_name in servers_to_unmount:
            await self.unmount(server_name)

        # Mount those servers (async gathered bc import does network roundtrip)
        mount_tasks = [self.mount_server(server_name) for server_name in servers_to_mount]
        await asyncio.gather(*mount_tasks)

        log.info("✅ Single User MCP server initialized with composite proxy")
        log.debug(
            f"Time taken to initialize Single User MCP server: {time.perf_counter() - start_time:.1f} seconds"
        )

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
            tool_list = await self.list_all_servers_tools_parallel()
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

        @self.resource("info://builtin/app")  # noqa
        def builtin_get_app_config() -> dict[str, Any]:
            """Get application configuration."""
            return {
                "version": Config().version,
                "mounted_servers": list(mounted_servers.keys()),
                "total_mounted": len(mounted_servers),
            }

        log.info("✅ Added built-in demo resources: info://builtin/app")

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
