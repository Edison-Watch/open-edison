"""
Single User MCP Server

FastMCP instance for the single-user Open Edison setup.
Handles MCP protocol communication with running servers using a unified composite proxy.
"""

import asyncio
import dataclasses
import json
import time
from typing import Any, TypedDict, cast

from fastmcp import Client as FastMCPClient
from fastmcp import Context, FastMCP
from fastmcp.prompts.prompt import Prompt
from fastmcp.resources.resource import Resource
from fastmcp.server.server import add_resource_prefix, has_resource_prefix
from fastmcp.tools.tool import Tool
from fastmcp.tools.tool_transform import apply_transformations_to_tools
from loguru import logger as log
from mcp.server.lowlevel.server import LifespanResultT

from src import events
from src.config import (
    Config,
    MCPServerConfig,
    clear_json_file_cache,
    ensure_permissions_file,
    get_config_dir,
)
from src.middleware.session_tracking import (
    SessionTrackingMiddleware,
    get_current_session_data_tracker,
)
from src.oauth_manager import OAuthManager, OAuthStatus, get_oauth_manager
from src.permissions import Permissions, PermissionsError


# ---- Module-level helpers for schema extraction ----
def _safe_model_json_schema(model: Any) -> Any | None:
    try:
        if hasattr(model, "model_json_schema"):
            return model.model_json_schema()
        if hasattr(model, "schema"):
            return model.schema()  # type: ignore[no-any-return]
    except Exception:
        return None
    return None


def _first_attr(obj: Any, names: tuple[str, ...]) -> Any | None:
    for attr in names:
        try:
            val = getattr(obj, attr, None)
        except Exception:
            val = None
        if val is not None:
            return val
    return None


def _extract_schemas_from_models(obj: Any) -> tuple[Any | None, Any | None]:
    input_model = getattr(obj, "input_model", None)
    output_model = getattr(obj, "output_model", None) or getattr(obj, "result_model", None)
    in_schema = _safe_model_json_schema(input_model) if input_model is not None else None
    out_schema = _safe_model_json_schema(output_model) if output_model is not None else None
    return in_schema, out_schema


def _extract_schemas_from_attrs(obj: Any) -> tuple[Any | None, Any | None]:
    in_schema = _first_attr(obj, ("input_schema", "inputSchema", "parameters_schema", "parameters"))
    out_schema = _first_attr(
        obj, ("output_schema", "outputSchema", "result_schema", "response_schema")
    )
    return in_schema, out_schema


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

        # Cache for tool schemas: { server_name: { tool_name: { input_schema, output_schema } } }
        self._tool_schemas: dict[str, dict[str, dict[str, Any | None]]] = {}

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

        # If the server returned no object types at all (all RuntimeError), likely misconfigured
        all_runtime_errors = all(
            isinstance(r, RuntimeError) for r in (tools, resources, templates, prompts)
        )
        if all_runtime_errors:
            log.error(
                f"❌ Server {prefix} appears to expose no tools, resources, templates, or prompts. "
                f"This likely indicates a misconfiguration."
            )
            events.fire_and_forget(
                {
                    "type": "mcp_server_warning",
                    "server": prefix,
                    "code": "no_objects",
                    "message": "Server exposes no tools/resources/templates/prompts. Likely misconfiguration.",
                }
            )
            return

        # Validate and normalize all results
        tools = self._validate_server_result(tools, "tools", prefix)
        resources = self._validate_server_result(resources, "resources", prefix)
        templates = self._validate_server_result(templates, "templates", prefix)
        prompts = self._validate_server_result(prompts, "prompts", prefix)

        # If after validation all objects are empty dicts, also misconfigured (avoid double logging)
        if not all_runtime_errors and all(
            len(x) == 0 for x in (tools, resources, templates, prompts)
        ):
            log.error(
                f"❌ Server {prefix} has no tools, resources, templates, or prompts after validation. "
                f"This likely indicates a misconfiguration."
            )
            events.fire_and_forget(
                {
                    "type": "mcp_server_warning",
                    "server": prefix,
                    "code": "empty_after_validation",
                    "message": "Server returned no tools/resources/templates/prompts after validation.",
                }
            )
            return

        # Import all components
        self._import_tools(tools, prefix)
        self._import_resources(resources, prefix)
        self._import_templates(templates, prefix)
        self._import_prompts(prompts, prefix)

        log.debug(
            f"Imported server {prefix} with "
            + ", ".join(
                part
                for part in (
                    f"{len(tools)} tools" if len(tools) > 0 else "",
                    f"{len(resources)} resources" if len(resources) > 0 else "",
                    f"{len(templates)} templates" if len(templates) > 0 else "",
                    f"{len(prompts)} prompts" if len(prompts) > 0 else "",
                )
                if part
            )
            or ValueError("No parts to join")
        )

    def _validate_server_result(
        self, result: Any, result_type: str, server_name: str
    ) -> dict[str, Any]:
        """Validate and normalize server result from asyncio.gather with return_exceptions=True."""
        if isinstance(result, RuntimeError):
            log.debug(f'Server {server_name} does not appear to contain "{result_type}"')
            return {}
        if isinstance(result, Exception):
            log.error(
                f'Server {server_name} received and unexpected exception when feetching "{result_type}". result: {result}'
            )
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
                events.fire_and_forget(
                    {
                        "type": "mcp_server_warning",
                        "server": server_name,
                        "code": "missing_url",
                        "message": "Remote server has no URL configured.",
                    }
                )
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
                    client = FastMCPClient(remote_url, auth=oauth_auth, timeout=client_timeout)
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

    def get_tool_schemas(self) -> dict[str, dict[str, dict[str, Any | None]]]:
        """Return a shallow copy of cached tool schemas keyed by server and tool name.

        The mapping shape is:
          { server_name: { tool_name: { "input_schema": dict|None, "output_schema": dict|None } } }
        """
        # Return a shallow copy to avoid accidental external mutation
        return {
            srv: {tn: {**schemas} for tn, schemas in tools.items()}
            for srv, tools in self._tool_schemas.items()
        }

    def _extract_tool_schemas(self, tool: Any) -> tuple[Any | None, Any | None]:
        """Best-effort extraction of input/output JSON Schemas from a tool object."""

        def _coalesce(a: Any | None, b: Any | None) -> Any | None:
            return a if a is not None else b

        in1, out1 = _extract_schemas_from_models(tool)
        in2, out2 = _extract_schemas_from_attrs(tool)
        return _coalesce(in1, in2), _coalesce(out1, out2)

    async def refresh_tool_schemas_cache(self) -> None:
        """Rebuild the cached tool schemas for all mounted servers.

        This should be called after (re)initialization so that schema data reflects
        the current set of mounted servers and their tools.
        """
        try:
            tools = await self.list_all_servers_tools_parallel()
        except Exception:
            log.exception("Failed to list tools while refreshing schemas cache")
            self._tool_schemas = {}
            return

        schemas: dict[str, dict[str, dict[str, Any | None]]] = {}
        for t in tools:
            try:
                key = getattr(t, "key", None)
                if not key or not isinstance(key, str):
                    continue
                # Expect format: "<server>_<tool>" for mounted items. Skip builtins without prefix.
                if "_" not in key:
                    continue
                server_name, tool_name = key.split("_", 1)
                in_schema, out_schema = self._extract_tool_schemas(t)
                if server_name not in schemas:
                    schemas[server_name] = {}
                schemas[server_name][tool_name] = {
                    "input_schema": in_schema,
                    "output_schema": out_schema,
                }
            except Exception:
                # Do not block caching due to a single tool failure
                log.debug(
                    f"Skipping schema extraction for tool due to error: {getattr(t, 'key', 'unknown')}"
                )
                continue

        self._tool_schemas = schemas

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

        # Figure out which servers are to be unmounted
        enabled_server_names = {s.name for s in enabled_servers}
        servers_to_unmount = [s for s in mounted_servers if s not in enabled_server_names]

        # Figure out which servers are to be mounted (new servers)
        servers_to_mount = [s.name for s in enabled_servers if s.name not in mounted_servers]

        # Figure out which servers need to be remounted due to config changes
        servers_to_remount: list[str] = []
        for server_config in enabled_servers:
            if server_config.name in mounted_servers:
                # Check if the configuration has changed
                current_config = mounted_servers[server_config.name]["config"]
                # This is a copy
                cmp_cur_config: MCPServerConfig = dataclasses.replace(  # type: ignore
                    current_config,  # type: ignore
                    enabled=server_config.enabled,  # type: ignore
                )
                if cmp_cur_config != server_config:
                    log.debug(f"🔄 Server {server_config.name} configuration changed, will remount")
                    servers_to_remount.append(server_config.name)

        # Unmount those servers (quick)
        for server_name in servers_to_unmount:
            await self.unmount(server_name)

        # Unmount servers that need remounting due to config changes
        for server_name in servers_to_remount:
            await self.unmount(server_name)

        # Mount new servers and remount changed servers
        all_servers_to_mount = servers_to_mount + servers_to_remount
        mount_tasks = [self.mount_server(server_name) for server_name in all_servers_to_mount]
        await asyncio.gather(*mount_tasks)

        log.info("✅ Single User MCP server initialized with composite proxy")
        log.debug(
            f"Time taken to initialize Single User MCP server: {time.perf_counter() - start_time:.1f} seconds"
        )
        # Reconcile permissions with mounted servers so JSONs reflect reality
        try:
            log.debug("Reconciling permissions")
            summary = await self.reconcile_permissions()
            log.info(
                "🔏 Permissions reconciled "
                + (
                    f"with {summary.get('added_missing_total', 0)} added items, "
                    if summary.get("added_missing_total", 0) > 0
                    else ""
                )
                + (
                    f"and {summary.get('removed_stale_total', 0)} removed items"
                    if summary.get("removed_stale_total", 0) > 0
                    else ""
                )
            )
        except Exception:
            log.exception("Failed to reconcile permissions after initialization")
        # Rebuild tool schema cache after initialization/remount
        try:
            await self.refresh_tool_schemas_cache()
        except Exception:
            log.exception("Failed to refresh tool schemas after initialization")

    async def reconcile_permissions(self) -> dict[str, Any]:  # noqa: C901
        """Reconcile permissions JSON files with currently mounted servers and their objects.

        Steps:
        1) Scan current tools/resources/prompts from mounted servers; collect canonical identifiers
        2) Compare against configured permissions; find missing and stale entries
        3) Update tool_permissions.json, resource_permissions.json, prompt_permissions.json to add
           missing entries (using current runtime defaults) and remove stale ones for mounted servers

        Returns a summary dict with counts and lists of changes.
        """
        mounted_names: set[str] = set(mounted_servers.keys())

        # ---- Discover actual items per type for mounted servers ----
        actual_tools_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}
        actual_prompts_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}
        actual_resources_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}

        # Enumerate using async gathers of list methods
        tasks: list[list[Tool | Prompt | Resource]] = [
            self._tool_manager.list_tools(),  # type: ignore[attr-defined]
            self._prompt_manager.list_prompts(),  # type: ignore[attr-defined]
            self._resource_manager.list_resources(),  # type: ignore[attr-defined]
        ]
        tools_list: list[Tool]
        prompts_list: list[Prompt]
        resources_list: list[Resource]
        tools_list, prompts_list, resources_list = await asyncio.gather(*tasks)  # type: ignore
        assert isinstance(tools_list, list)
        assert isinstance(prompts_list, list)
        assert isinstance(resources_list, list)

        # We also remove the builtin tools
        tools_list = [t for t in tools_list if not t.key.startswith("builtin_")]  # type: ignore
        resources_list = [r for r in resources_list if not r.key.startswith("info://builtin/")]  # type: ignore
        prompts_list = [p for p in prompts_list if not p.key.startswith("builtin_")]  # type: ignore

        # For typing
        server: str
        item: str

        for tool in tools_list:
            server, item = tool.key.split("_", 1)
            if server in mounted_names:
                actual_tools_by_server.setdefault(server, set()).add(item)
            else:
                raise ValueError(f"Server {server} not found in {mounted_names}")

        for prompt in prompts_list:
            server, item = prompt.key.split("_", 1)
            if server in mounted_names:
                actual_prompts_by_server.setdefault(server, set()).add(item)
            else:
                raise ValueError(f"Server {server} not found in {mounted_names}")

        # Resources (resource://prefix/path/to/resource)
        for res in resources_list:
            rkey: str = str(getattr(res, "key", ""))
            if not rkey.startswith("resource://"):
                raise ValueError(f"Resource {rkey} does not start with resource://")
            rest: str = rkey[len("resource://") :]
            server = rest.split("/", 1)[0]
            if not server or server not in mounted_names:
                raise ValueError(f"Server {server} not found in {mounted_names}")
            item_id: str = str(getattr(res, "uri", ""))
            if not item_id:
                raise ValueError(f"Resource {rkey} has no URI")
            actual_resources_by_server.setdefault(server, set()).add(item_id)

        # ---- Load current permissions (flattened via Permissions) ----
        perms = Permissions()

        configured_tools_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}
        invalid_tools: set[str] = set()
        for flat in (k for k in perms.tool_permissions if k):  # type: ignore
            flat_str = str(flat)
            if "_" not in flat_str:
                invalid_tools.add(flat_str)
                continue
            s, item = flat_str.split("_", 1)
            if not item:
                invalid_tools.add(flat_str)
                continue
            if s in mounted_names:
                configured_tools_by_server.setdefault(s, set()).add(item)

        configured_prompts_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}
        invalid_prompts: set[str] = set()
        for flat in (k for k in perms.prompt_permissions if k):
            flat_str = str(flat)
            if "_" not in flat_str:
                invalid_prompts.add(flat_str)
                continue
            s, item = flat_str.split("_", 1)
            if not item:
                invalid_prompts.add(flat_str)
                continue
            if s in mounted_names:
                configured_prompts_by_server.setdefault(s, set()).add(item)

        configured_resources_by_server: dict[str, set[str]] = {s: set() for s in mounted_names}
        invalid_resources: set[str] = set()
        for flat in (k for k in perms.resource_permissions if k):
            flat_str = str(flat)
            if "_" not in flat_str:
                invalid_resources.add(flat_str)
                continue
            s, item = flat_str.split("_", 1)
            if not item or "://" not in item:
                invalid_resources.add(flat_str)
                continue
            if s in mounted_names:
                configured_resources_by_server.setdefault(s, set()).add(item)

        # ---- Compute diffs ----
        missing_tools: dict[str, set[str]] = {}
        missing_prompts: dict[str, set[str]] = {}
        missing_resources: dict[str, set[str]] = {}
        stale_tools: dict[str, set[str]] = {}
        stale_prompts: dict[str, set[str]] = {}
        stale_resources: dict[str, set[str]] = {}

        for s in mounted_names:
            # Tools
            if actual_tools_by_server.get(s):
                m = actual_tools_by_server[s] - configured_tools_by_server.get(s, set())
                if m:
                    missing_tools[s] = m
                    for item in sorted(m):
                        log.warning(f"Permissions missing for tool: {s}_{item}")
            if configured_tools_by_server.get(s):
                st = configured_tools_by_server[s] - actual_tools_by_server.get(s, set())
                if st:
                    stale_tools[s] = st
                    for item in sorted(st):
                        log.error(f"Permission configured for non-existent tool: {s}_{item}")
            # Mark malformed tool keys as stale
            for flat_str in invalid_tools:
                if flat_str.startswith(f"{s}_"):
                    stale_tools[s] = stale_tools.get(s, set()) | {flat_str.split("_", 1)[1]}
                    log.warning(
                        f"Permission configured for non-existent tool: {s}_{flat_str.split('_', 1)[1]}"
                    )

            # Prompts
            if actual_prompts_by_server.get(s):
                m = actual_prompts_by_server[s] - configured_prompts_by_server.get(s, set())
                if m:
                    missing_prompts[s] = m
                    for item in sorted(m):
                        log.warning(f"Permissions missing for prompt: {s}_{item}")
            if configured_prompts_by_server.get(s):
                st = configured_prompts_by_server[s] - actual_prompts_by_server.get(s, set())
                if st:
                    stale_prompts[s] = st
                    for item in sorted(st):
                        log.error(f"Permission configured for non-existent prompt: {s}_{item}")
            # Mark malformed prompt keys as stale
            for flat_str in invalid_prompts:
                if flat_str.startswith(f"{s}_"):
                    stale_prompts[s] = stale_prompts.get(s, set()) | {flat_str.split("_", 1)[1]}
                    log.warning(
                        f"Permission configured for non-existent prompt: {s}_{flat_str.split('_', 1)[1]}"
                    )

            # Resources
            if actual_resources_by_server.get(s):
                m = actual_resources_by_server[s] - configured_resources_by_server.get(s, set())
                if m:
                    missing_resources[s] = m
                    for item in sorted(m):
                        log.warning(f"Permissions missing for resource: {s}_{item}")
            if configured_resources_by_server.get(s):
                st = configured_resources_by_server[s] - actual_resources_by_server.get(s, set())
                if st:
                    stale_resources[s] = st
                    for item in sorted(st):
                        log.error(f"Permission configured for non-existent resource: {s}_{item}")
            # Mark malformed resource keys as stale
            for flat_str in invalid_resources:
                if flat_str.startswith(f"{s}_"):
                    stale_resources[s] = stale_resources.get(s, set()) | {flat_str.split("_", 1)[1]}
                    log.warning(
                        f"Permission configured for non-existent resource: {s}_{flat_str.split('_', 1)[1]}"
                    )

        # ---- Apply fixes to JSON files ----
        cfg_dir = get_config_dir()

        def load_nested(filename: str) -> tuple[str, dict[str, Any]]:
            path = ensure_permissions_file(cfg_dir / filename)
            with open(path, encoding="utf-8") as f:
                obj: Any = json.load(f)
            if not isinstance(obj, dict):
                data: dict[str, Any] = {"_metadata": {}}
            else:
                data = cast(dict[str, Any], obj)
            return str(path), data

        def save_nested(path: str, data: dict[str, Any]) -> None:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

        added_missing_total = 0
        removed_stale_total = 0

        # Tools file
        tools_path, tools_json = load_nested("tool_permissions.json")
        for s, items in missing_tools.items():
            section = tools_json.get(s, {})
            assert isinstance(section, dict), "Section is not a dict"
            for item in sorted(items):
                if item not in section:
                    # Use current runtime default to mirror behavior for unknowns
                    section[item] = {
                        "enabled": True,
                        "write_operation": True,
                        "read_private_data": True,
                        "read_untrusted_public_data": True,
                        "acl": "SECRET",
                    }
                    added_missing_total += 1
            tools_json[s] = section
        for s, items in stale_tools.items():
            section = tools_json.get(s)
            if isinstance(section, dict):
                for item in sorted(items):
                    if item in section:
                        del section[item]
                        removed_stale_total += 1
                tools_json[s] = section
        save_nested(tools_path, tools_json)

        # Resources file
        resources_path, resources_json = load_nested("resource_permissions.json")
        for s, items in missing_resources.items():
            section = resources_json.get(s, {})
            assert isinstance(section, dict), "Section is not a dict"
            for item in sorted(items):
                if item not in section:
                    section[item] = {
                        "enabled": True,
                        "write_operation": True,
                        "read_private_data": True,
                        "read_untrusted_public_data": True,
                    }
                    added_missing_total += 1
            resources_json[s] = section
        for s, items in stale_resources.items():
            section = resources_json.get(s, {})
            assert isinstance(section, dict), "Section is not a dict"
            for item in sorted(items):
                if item in section:
                    del section[item]
                    removed_stale_total += 1
            resources_json[s] = section
        save_nested(resources_path, resources_json)

        # Prompts file
        prompts_path, prompts_json = load_nested("prompt_permissions.json")
        for s, items in missing_prompts.items():
            section = prompts_json.get(s, {})
            assert isinstance(section, dict), "Section is not a dict"
            for item in sorted(items):
                if item not in section:
                    section[item] = {
                        "enabled": True,
                        "write_operation": True,
                        "read_private_data": True,
                        "read_untrusted_public_data": True,
                        "acl": "SECRET",
                    }
                    added_missing_total += 1
            prompts_json[s] = section
        for s, items in stale_prompts.items():
            section = prompts_json.get(s, {})
            assert isinstance(section, dict), "Section is not a dict"
            for item in sorted(items):
                if item in section:
                    del section[item]
                    removed_stale_total += 1
            prompts_json[s] = section
        save_nested(prompts_path, prompts_json)

        # Invalidate caches so subsequent reads see the updates
        clear_json_file_cache()
        Permissions.clear_permissions_file_cache()

        log.debug(
            f"Done with reconciliation, found {added_missing_total} added items and {removed_stale_total} removed items"
        )
        return {
            "added_missing_total": added_missing_total,
            "removed_stale_total": removed_stale_total,
            "missing": {
                "tools": {k: sorted(v) for k, v in missing_tools.items()},
                "resources": {k: sorted(v) for k, v in missing_resources.items()},
                "prompts": {k: sorted(v) for k, v in missing_prompts.items()},
            },
            "stale": {
                "tools": {k: sorted(v) for k, v in stale_tools.items()},
                "resources": {k: sorted(v) for k, v in stale_resources.items()},
                "prompts": {k: sorted(v) for k, v in stale_prompts.items()},
            },
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
