"""
Permissions management for Open Edison

Simple JSON-based permissions for single-user MCP proxy.
Reads tool, resource, and prompt permission files and provides a singleton interface.
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from loguru import logger as log  # pyright: ignore[reportUnknownVariableType]

from src.config import Config, ensure_permissions_file, get_config_dir


def _default_permissions_dir() -> Path:
    return get_config_dir()


# ACL ranking for permission levels
ACL_RANK: dict[str, int] = {"PUBLIC": 0, "PRIVATE": 1, "SECRET": 2}


class PermissionsError(Exception):
    """Exception raised for permissions-related errors"""

    def __init__(self, message: str, permissions_path: Path | None = None):
        self.message = message
        self.permissions_path = permissions_path
        super().__init__(self.message)


@dataclass
class ToolPermission:
    """Individual tool permission configuration"""

    enabled: bool = False
    write_operation: bool = False
    read_private_data: bool = False
    read_untrusted_public_data: bool = False
    acl: str = "PUBLIC"
    description: str | None = None


@dataclass
class ResourcePermission:
    """Individual resource permission configuration"""

    enabled: bool = False
    write_operation: bool = False
    read_private_data: bool = False
    read_untrusted_public_data: bool = False
    acl: str = "PUBLIC"
    # Optional metadata fields (ignored by enforcement but accepted from JSON)
    description: str | None = None


@dataclass
class PromptPermission:
    """Individual prompt permission configuration"""

    enabled: bool = False
    write_operation: bool = False
    read_private_data: bool = False
    read_untrusted_public_data: bool = False
    # Optional metadata fields (ignored by enforcement but accepted from JSON)
    description: str | None = None
    acl: str = "PUBLIC"


@dataclass
class PermissionsMetadata:
    """Metadata for permissions files"""

    description: str
    last_updated: str  # noqa


@dataclass
class Permissions:
    """Main permissions class"""

    tool_permissions: dict[str, ToolPermission]
    resource_permissions: dict[str, ResourcePermission]
    prompt_permissions: dict[str, PromptPermission]
    tool_metadata: PermissionsMetadata | None = None
    resource_metadata: PermissionsMetadata | None = None
    prompt_metadata: PermissionsMetadata | None = None

    def __init__(
        self,
        permissions_dir: Path | None = None,
        *,
        tool_permissions: dict[str, ToolPermission] | None = None,
        resource_permissions: dict[str, ResourcePermission] | None = None,
        prompt_permissions: dict[str, PromptPermission] | None = None,
    ) -> None:
        """Load permissions from JSON files or provide them directly."""
        if permissions_dir is None:
            permissions_dir = _default_permissions_dir()

        if tool_permissions is None:
            tool_permissions_path = permissions_dir / "tool_permissions.json"
            tool_permissions, tool_metadata = self._load_permission_file(
                tool_permissions_path, ToolPermission
            )
            self.tool_metadata = tool_metadata

        if resource_permissions is None:
            resource_permissions_path = permissions_dir / "resource_permissions.json"
            resource_permissions, resource_metadata = self._load_permission_file(
                resource_permissions_path, ResourcePermission
            )
            self.resource_metadata = resource_metadata

        if prompt_permissions is None:
            prompt_permissions_path = permissions_dir / "prompt_permissions.json"
            prompt_permissions, prompt_metadata = self._load_permission_file(
                prompt_permissions_path, PromptPermission
            )
            self.prompt_metadata = prompt_metadata

        self.tool_permissions = tool_permissions
        self.resource_permissions = resource_permissions
        self.prompt_permissions = prompt_permissions

    @classmethod
    def _extract_metadata(cls, data: dict[str, Any]) -> PermissionsMetadata | None:
        """Extract metadata from permission file data."""
        metadata_data = data.get("_metadata", {})
        if not metadata_data:
            return None

        return PermissionsMetadata(
            description=str(metadata_data.get("description", "")),
            last_updated=str(metadata_data.get("last_updated", "")),
        )

    @classmethod
    def _validate_server_data(cls, server_name: str, server_items_data: Any) -> None:
        """Validate server data structure."""
        if not isinstance(server_items_data, dict):
            log.warning(
                f"Invalid server data for {server_name}: expected dict, got {type(server_items_data)}"
            )
            raise PermissionsError(
                f"Invalid server data for {server_name}: expected dict, got {type(server_items_data)}"
            )

    @classmethod
    def _validate_item_data(cls, server_name: str, item_name: str, item_data: Any) -> None:
        """Validate item data structure."""
        if not isinstance(item_data, dict):
            log.warning(
                f"Invalid item permissions for {server_name}/{item_name}: expected dict, got {type(item_data)}"
            )
            raise PermissionsError(
                f"Invalid item permissions for {server_name}/{item_name}: expected dict, got {type(item_data)}"
            )

    @classmethod
    def clear_permissions_file_cache(cls) -> None:
        """Clear the cache for the JSON permissions files"""
        cls._load_permission_file.cache_clear()

    @classmethod
    @cache
    def _load_permission_file(
        cls,
        file_path: Path,
        permission_class: type[ToolPermission] | type[ResourcePermission] | type[PromptPermission],
    ) -> tuple[dict[str, Any], PermissionsMetadata | None]:
        """Load permissions from a single JSON file.

        Returns a tuple of (permissions_dict, metadata)
        """
        permissions: dict[str, Any] = {}
        metadata: PermissionsMetadata | None = None

        # Centralized bootstrap: ensure file exists or create from repo defaults
        file_path = ensure_permissions_file(file_path)

        with open(file_path) as f:
            data: dict[str, Any] = json.load(f)

        # Extract metadata
        metadata = cls._extract_metadata(data)

        # Parse permissions with duplicate checking
        for server_name, server_items_data in data.items():
            if server_name == "_metadata":
                continue

            cls._validate_server_data(server_name, server_items_data)

            for item_name, item_data in server_items_data.items():  # type: ignore
                cls._validate_item_data(server_name, item_name, item_data)

                # Type casting for clarity
                item_name_str: str = str(item_name)  # type: ignore
                item_data_dict: dict[str, Any] = item_data  # type: ignore

                # Create permission object (flat structure)
                permissions[server_name + "_" + item_name_str] = permission_class(**item_data_dict)

        log.debug(f"Loaded {len(permissions)} items from {len(data)} servers in {file_path}")

        return permissions, metadata

    def get_tool_permission(self, tool_name: str) -> ToolPermission:
        """Get permission for a specific tool"""
        if tool_name not in self.tool_permissions:
            if tool_name.startswith(("builtin_", "agent_")):
                log.info(f"Tool '{tool_name}' not found; returning safe default (enabled, 0 risk)")
                return ToolPermission(
                    enabled=True,
                    write_operation=False,
                    read_private_data=False,
                    read_untrusted_public_data=False,
                    acl="PUBLIC",
                )
            log.warning(
                f"Tool '{tool_name}' not found in permissions; returning enabled full-trifecta default"
            )
            return ToolPermission(
                enabled=True,
                write_operation=True,
                read_private_data=True,
                read_untrusted_public_data=True,
                acl="SECRET",
            )
        return self.tool_permissions[tool_name]

    def get_resource_permission(self, resource_name: str) -> ResourcePermission:
        """Get permission for a specific resource"""
        if resource_name not in self.resource_permissions:
            if resource_name.startswith("builtin_"):
                log.info(
                    f"Resource '{resource_name}' not found; returning builtin safe default (enabled, 0 risk)"
                )
                return ResourcePermission(
                    enabled=True,
                    write_operation=False,
                    read_private_data=False,
                    read_untrusted_public_data=False,
                )
            log.warning(
                f"Resource '{resource_name}' not found in permissions; returning enabled full-trifecta default"
            )
            return ResourcePermission(
                enabled=True,
                write_operation=True,
                read_private_data=True,
                read_untrusted_public_data=True,
            )
        return self.resource_permissions[resource_name]

    def get_prompt_permission(self, prompt_name: str) -> PromptPermission:
        """Get permission for a specific prompt"""
        if prompt_name not in self.prompt_permissions:
            if prompt_name.startswith("builtin_"):
                log.info(
                    f"Prompt '{prompt_name}' not found; returning builtin safe default (enabled, 0 risk)"
                )
                return PromptPermission(
                    enabled=True,
                    write_operation=False,
                    read_private_data=False,
                    read_untrusted_public_data=False,
                    acl="PUBLIC",
                )
            log.warning(
                f"Prompt '{prompt_name}' not found in permissions; returning enabled full-trifecta default"
            )
            return PromptPermission(
                enabled=True,
                write_operation=True,
                read_private_data=True,
                read_untrusted_public_data=True,
                acl="SECRET",
            )
        return self.prompt_permissions[prompt_name]

    def is_tool_enabled(self, tool_name: str) -> bool:
        """Check if a tool is enabled
        Also checks if the server is enabled"""
        permission = self.get_tool_permission(tool_name)
        # Agent-side tools (agent_*) are not backed by any MCP server; rely solely on permission.enabled
        if tool_name.startswith("agent_"):
            return bool(permission.enabled)
        try:
            server_name = self.server_name_from_tool_name(tool_name)
            server_enabled = self.is_server_enabled(server_name)
        except PermissionsError:
            log.warning(f"Server resolution failed for tool '{tool_name}'; treating as disabled")
            server_enabled = False
        return permission.enabled and server_enabled

    def is_resource_enabled(self, resource_name: str) -> bool:
        """Check if a resource is enabled
        Also checks if the server is enabled"""
        permission = self.get_resource_permission(resource_name)
        try:
            server_name = self.server_name_from_tool_name(resource_name)
            server_enabled = self.is_server_enabled(server_name)
        except PermissionsError:
            log.warning(
                f"Server resolution failed for resource '{resource_name}'; treating as disabled"
            )
            server_enabled = False
        return permission.enabled and server_enabled

    def is_prompt_enabled(self, prompt_name: str) -> bool:
        """Check if a prompt is enabled
        Also checks if the server is enabled"""
        permission = self.get_prompt_permission(prompt_name)
        try:
            server_name = self.server_name_from_tool_name(prompt_name)
            server_enabled = self.is_server_enabled(server_name)
        except PermissionsError:
            log.warning(
                f"Server resolution failed for prompt '{prompt_name}'; treating as disabled"
            )
            server_enabled = False
        return permission.enabled and server_enabled

    @staticmethod
    def server_name_from_tool_name(tool_name: str) -> str:
        """Get the server name from a tool name"""
        parts = tool_name.split("_")
        if len(parts) == 0:
            raise PermissionsError(f"Tool name {tool_name} is invalid")
        if parts[0] == "builtin":
            return "builtin"

        server_names = {s.name for s in Config().mcp_servers}
        for i in range(len(parts)):
            server_name = "_".join(parts[:i])
            if server_name in server_names:
                return server_name
        raise PermissionsError(f"Server name not found for tool {tool_name}")

    @staticmethod
    def is_server_enabled(server_name: str) -> bool:
        """Check if a server is enabled"""
        if server_name == "builtin":
            return True
        server_config = next((s for s in Config().mcp_servers if s.name == server_name), None)
        return server_config is not None and server_config.enabled


def normalize_acl(value: str | None, *, default: str = "PUBLIC") -> str:
    """Normalize ACL string, defaulting and uppercasing; validate against known values."""
    try:
        if value is None:
            return default
        acl = str(value).upper().strip()
        if acl not in ACL_RANK:
            # Fallback to default if invalid
            return default
        return acl
    except Exception:
        return default


def _load_permission_overrides(
    override_file: Path,
    permission_class: type[ToolPermission] | type[ResourcePermission] | type[PromptPermission],
    base_perms: dict[str, Any],
) -> dict[str, Any]:
    """Load and merge permission overrides from a file."""
    if not override_file.exists():
        return base_perms

    perms = dict(base_perms)
    with open(override_file) as f:
        overrides = json.load(f)
        for server_name, items in overrides.items():
            if server_name == "_metadata":
                continue
            for item_name, item_data in items.items():  # type: ignore
                key = f"{server_name}_{item_name}"
                perms[key] = permission_class(**item_data)  # type: ignore
    return perms


def apply_agent_overrides(
    base_permissions: Permissions,
    agent_name: str,
    config_dir: Path | None = None,
) -> Permissions:
    """
    Apply agent-specific permission overrides to base permissions.

    Args:
        base_permissions: Base permissions loaded from config dir
        agent_name: Name of the agent (e.g., "hr_assistant")
        config_dir: Config directory path (defaults to get_config_dir())

    Returns:
        New Permissions object with agent overrides applied

    Raises:
        FileNotFoundError: If agent folder doesn't exist
    """
    if config_dir is None:
        config_dir = get_config_dir()

    agent_dir = config_dir / "agents" / agent_name

    if not agent_dir.exists():
        raise FileNotFoundError(
            f"Agent config folder not found: {agent_dir}\nCreate folder at: {agent_dir}"
        )

    # Apply overrides for each permission type
    tool_perms = _load_permission_overrides(
        agent_dir / "tool_permissions.json",
        ToolPermission,
        base_permissions.tool_permissions,
    )
    prompt_perms = _load_permission_overrides(
        agent_dir / "prompt_permissions.json",
        PromptPermission,
        base_permissions.prompt_permissions,
    )
    resource_perms = _load_permission_overrides(
        agent_dir / "resource_permissions.json",
        ResourcePermission,
        base_permissions.resource_permissions,
    )

    return Permissions(
        tool_permissions=tool_perms,
        resource_permissions=resource_perms,
        prompt_permissions=prompt_perms,
    )
