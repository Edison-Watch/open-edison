"""
Permissions management for Open Edison

Simple JSON-based permissions for single-user MCP proxy.
Reads tool, resource, and prompt permission files and provides a singleton interface.
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, TypedDict, cast

from loguru import logger as log

from src.config import get_config_dir

# Get the path to the repository/package root directory (module src/ parent)
root_dir = Path(__file__).parent.parent


def _default_permissions_dir() -> Path:
    """Determine default config.json path.

    In development (editable or source checkout), prefer repository root
    `config.json` when present. In an installed package (site-packages),
    use the resolved user config dir.
    """
    repo_pyproject = root_dir / "pyproject.toml"

    # If pyproject.toml exists next to src/, we are likely in a repo checkout
    if repo_pyproject.exists():
        return root_dir

    # Otherwise, prefer user config directory
    return get_config_dir()


# ACL ranking for permission levels
ACL_RANK: dict[str, int] = {"PUBLIC": 0, "PRIVATE": 1, "SECRET": 2}

# Default flat permissions applied when fields are missing in config
DEFAULT_PERMISSIONS: dict[str, Any] = {
    "enabled": False,
    "write_operation": False,
    "read_private_data": False,
    "read_untrusted_public_data": False,
    "acl": "PUBLIC",
}


def normalize_acl(value: Any, *, default: str = "PUBLIC") -> str:
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


def _apply_permission_defaults(config_perms: dict[str, Any]) -> dict[str, Any]:
    """Merge provided config flags with DEFAULT_PERMISSIONS, including ACL derivation."""
    # Start from defaults
    merged: dict[str, Any] = dict(DEFAULT_PERMISSIONS)
    # Booleans
    enabled = bool(config_perms.get("enabled", merged["enabled"]))
    write_operation = bool(config_perms.get("write_operation", merged["write_operation"]))
    read_private_data = bool(config_perms.get("read_private_data", merged["read_private_data"]))
    read_untrusted_public_data = bool(
        config_perms.get("read_untrusted_public_data", merged["read_untrusted_public_data"])
    )

    # ACL: explicit value wins; otherwise default PRIVATE if read_private_data True, else default
    if "acl" in config_perms and config_perms.get("acl") is not None:
        acl = normalize_acl(config_perms.get("acl"), default=str(merged["acl"]))
    else:
        acl = normalize_acl("PRIVATE" if read_private_data else str(merged["acl"]))

    merged.update(
        {
            "enabled": enabled,
            "write_operation": write_operation,
            "read_private_data": read_private_data,
            "read_untrusted_public_data": read_untrusted_public_data,
            "acl": acl,
        }
    )
    return merged


def apply_permission_defaults(config_perms: dict[str, Any]) -> dict[str, Any]:
    """Public wrapper for _apply_permission_defaults."""
    return _apply_permission_defaults(config_perms)


def _get_builtin_tool_permissions(name: str) -> dict[str, Any] | None:
    """Get permissions for built-in safe tools."""
    builtin_safe_tools = [
        "echo",
        "get_server_info",
        "get_security_status",
        "get_available_tools",
        "tools_changed",
    ]
    if name in builtin_safe_tools:
        permissions = _apply_permission_defaults({"enabled": True})
        log.debug(f"Built-in safe tool {name}: {permissions}")
        return permissions
    return None


def _get_exact_match_permissions(
    name: str, permissions_config: dict[str, dict[str, Any]], type_name: str
) -> dict[str, Any] | None:
    """Check for exact match permissions."""
    if name in permissions_config and not name.startswith("_"):
        config_perms = permissions_config[name]
        permissions = _apply_permission_defaults(config_perms)
        log.debug(f"Found exact match for {type_name} {name}: {permissions}")
        return permissions
    # Fallback: support names like "server_tool" by checking the part after first underscore
    if "_" in name:
        suffix = name.split("_", 1)[1]
        if suffix in permissions_config and not suffix.startswith("_"):
            config_perms = permissions_config[suffix]
            permissions = _apply_permission_defaults(config_perms)
            log.debug(
                f"Found fallback match for {type_name} {name} using suffix {suffix}: {permissions}"
            )
            return permissions
    return None


def _get_wildcard_patterns(name: str, type_name: str) -> list[str]:
    """Generate wildcard patterns based on name and type."""
    wildcard_patterns: list[str] = []

    if type_name == "tool" and "/" in name:
        # For tools: server_name/*
        server_name, _ = name.split("/", 1)
        wildcard_patterns.append(f"{server_name}/*")
    elif type_name == "resource":
        # For resources: scheme:*, just like tools do server_name/*
        if ":" in name:
            scheme, _ = name.split(":", 1)
            wildcard_patterns.append(f"{scheme}:*")
    elif type_name == "prompt":
        # For prompts: template:*, prompt:file:*, etc.
        if ":" in name:
            parts = name.split(":")
            if len(parts) >= 2:
                wildcard_patterns.append(f"{parts[0]}:*")
                # For nested patterns like prompt:file:*, check prompt:file:*
                if len(parts) >= 3:
                    wildcard_patterns.append(f"{parts[0]}:{parts[1]}:*")

    return wildcard_patterns


@cache
def classify_tool_permissions_cached(tool_name: str) -> dict[str, Any]:
    """Classify tool permissions with LRU caching."""
    return _classify_permissions_cached(tool_name, permissions.get_all_tools(), "tool")


def clear_classify_tool_permissions_cache() -> None:
    """Clear the tool permissions cache to force reload from file."""
    classify_tool_permissions_cached.cache_clear()
    log.info("Tool permissions cache cleared")


@cache
def classify_resource_permissions_cached(resource_name: str) -> dict[str, Any]:
    """Classify resource permissions with LRU caching."""
    return _classify_permissions_cached(resource_name, permissions.get_all_resources(), "resource")


def clear_classify_resource_permissions_cache() -> None:
    """Clear the resource permissions cache to force reload from file."""
    classify_resource_permissions_cached.cache_clear()
    log.info("Resource permissions cache cleared")


@cache
def classify_prompt_permissions_cached(prompt_name: str) -> dict[str, Any]:
    """Classify prompt permissions with LRU caching."""
    return _classify_permissions_cached(prompt_name, permissions.get_all_prompts(), "prompt")


def clear_classify_prompt_permissions_cache() -> None:
    """Clear the prompt permissions cache to force reload from file."""
    classify_prompt_permissions_cached.cache_clear()
    log.info("Prompt permissions cache cleared")


def clear_all_classify_permissions_caches() -> None:
    """Clear all classify permissions caches to force reload from files."""
    clear_classify_tool_permissions_cache()
    clear_classify_resource_permissions_cache()
    clear_classify_prompt_permissions_cache()
    log.info("All classify permissions caches cleared")


def _classify_permissions_cached(
    name: str,
    permissions_config: dict[str, "ToolPermission | ResourcePermission | PromptPermission"],
    type_name: str,
) -> dict[str, Any]:
    """Generic permission classification with pattern matching support."""
    # Built-in safe tools that don't need external config (only for tools)
    if type_name == "tool":
        builtin_perms = _get_builtin_tool_permissions(name)
        if builtin_perms is not None:
            return builtin_perms

    # Check for exact match first
    exact_perms = _get_exact_match_permissions(
        name, cast(dict[str, dict[str, Any]], permissions_config), type_name
    )
    if exact_perms is not None:
        return exact_perms

    # Try wildcard patterns
    wildcard_patterns = _get_wildcard_patterns(name, type_name)
    for pattern in wildcard_patterns:
        if pattern in permissions_config:
            config_perms = permissions_config[pattern]
            permissions = _apply_permission_defaults(cast(dict[str, Any], config_perms))
            log.debug(f"Found wildcard match for {type_name} {name} using {pattern}: {permissions}")
            return permissions

    # No configuration found - raise error instead of defaulting to safe
    config_file = f"{type_name}_permissions.json"
    log.error(
        f"No security configuration found for {type_name} '{name}'. All {type_name}s must be explicitly configured in {config_file}"
    )
    raise ValueError(
        f"No security configuration found for {type_name} '{name}'. All {type_name}s must be explicitly configured in {config_file}"
    )


class PermissionsError(Exception):
    """Exception raised for permissions-related errors"""

    def __init__(self, message: str, permissions_path: Path | None = None):
        self.message = message
        self.permissions_path = permissions_path
        super().__init__(self.message)


class ToolPermission(TypedDict, total=False):
    """Individual tool permission configuration"""

    enabled: bool
    write_operation: bool
    read_private_data: bool
    read_untrusted_public_data: bool
    acl: str
    description: str | None


class ResourcePermission(TypedDict, total=False):
    """Individual resource permission configuration"""

    enabled: bool
    write_operation: bool
    read_private_data: bool
    read_untrusted_public_data: bool


class PromptPermission(TypedDict, total=False):
    """Individual prompt permission configuration"""

    enabled: bool
    write_operation: bool
    read_private_data: bool
    read_untrusted_public_data: bool


@dataclass
class PermissionsMetadata:
    """Metadata for permissions files"""

    description: str
    last_updated: str


@dataclass
class Permissions:
    """Main permissions class"""

    tool_permissions: dict[str, ToolPermission]
    resource_permissions: dict[str, ResourcePermission]
    prompt_permissions: dict[str, PromptPermission]
    tool_metadata: PermissionsMetadata | None = None
    resource_metadata: PermissionsMetadata | None = None
    prompt_metadata: PermissionsMetadata | None = None
    _permissions_dir: Path | None = None

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
    def _validate_server_data(cls, server_name: str, server_items_data: Any) -> bool:
        """Validate server data structure."""
        if not isinstance(server_items_data, dict):
            log.warning(
                f"Invalid server data for {server_name}: expected dict, got {type(server_items_data)}"
            )
            return False
        return True

    @classmethod
    def _validate_item_data(cls, server_name: str, item_name: str, item_data: Any) -> bool:
        """Validate item data structure."""
        if not isinstance(item_data, dict):
            log.warning(
                f"Invalid item permissions for {server_name}/{item_name}: expected dict, got {type(item_data)}"
            )
            return False
        return True

    @classmethod
    def _check_duplicate_in_server(
        cls, item_name: str, server_name: str, server_items_tracking: dict[str, set[str]]
    ) -> None:
        """Check for duplicate items within the same server."""
        if item_name in server_items_tracking[server_name]:
            log.error(f"Duplicate item '{item_name}' found in server '{server_name}'")
            raise PermissionsError(f"Duplicate item '{item_name}' found in server '{server_name}'")

    @classmethod
    def _check_duplicate_across_servers(
        cls, item_name: str, server_name: str, item_to_server: dict[str, str]
    ) -> None:
        """Check for duplicate items across different servers."""
        if item_name in item_to_server:
            existing_server = item_to_server[item_name]
            log.error(
                f"Duplicate item '{item_name}' found in servers '{existing_server}' and '{server_name}'"
            )
            raise PermissionsError(
                f"Duplicate item '{item_name}' found in servers '{existing_server}' and '{server_name}'"
            )

    @classmethod
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

        if not file_path.exists():
            log.warning(f"Permissions file not found at {file_path}")
            return permissions, metadata

        with open(file_path) as f:
            data: dict[str, Any] = json.load(f)

        # Extract metadata
        metadata = cls._extract_metadata(data)

        # Tracking maps for duplicate detection
        item_to_server: dict[str, str] = {}
        server_items_tracking: dict[str, set[str]] = {}

        # Parse permissions with duplicate checking
        for server_name, server_items_data in data.items():
            if server_name == "_metadata":
                continue

            if not cls._validate_server_data(server_name, server_items_data):
                continue

            server_items_tracking[server_name] = set()

            for item_name, item_data in server_items_data.items():  # type: ignore
                if not cls._validate_item_data(server_name, item_name, item_data):
                    continue

                # Type casting for clarity
                item_name_str: str = str(item_name)  # type: ignore
                item_data_dict: dict[str, Any] = item_data  # type: ignore

                # Check for duplicates
                cls._check_duplicate_in_server(item_name_str, server_name, server_items_tracking)
                cls._check_duplicate_across_servers(item_name_str, server_name, item_to_server)

                # Add to tracking maps
                item_to_server[item_name_str] = server_name
                server_items_tracking[server_name].add(item_name_str)

                # Create permission object (flat structure) with defaults applied
                permissions[item_name_str] = _apply_permission_defaults(item_data_dict)

        log.debug(
            f"Loaded {len(item_to_server)} items from {len(server_items_tracking)} servers in {file_path}"
        )

        return permissions, metadata

    @classmethod
    def load(cls, permissions_dir: Path | None = None) -> "Permissions":
        """Load permissions from JSON files.

        If no directory is provided, uses get_config_dir().
        """
        if permissions_dir is None:
            permissions_dir = _default_permissions_dir()

        tool_permissions_path = permissions_dir / "tool_permissions.json"
        resource_permissions_path = permissions_dir / "resource_permissions.json"
        prompt_permissions_path = permissions_dir / "prompt_permissions.json"

        # Load all permission types using the helper method
        tool_permissions, tool_metadata = cls._load_permission_file(
            tool_permissions_path, ToolPermission
        )
        resource_permissions, resource_metadata = cls._load_permission_file(
            resource_permissions_path, ResourcePermission
        )
        prompt_permissions, prompt_metadata = cls._load_permission_file(
            prompt_permissions_path, PromptPermission
        )

        return cls(
            tool_permissions=tool_permissions,
            resource_permissions=resource_permissions,
            prompt_permissions=prompt_permissions,
            tool_metadata=tool_metadata,
            resource_metadata=resource_metadata,
            prompt_metadata=prompt_metadata,
            _permissions_dir=permissions_dir,
        )

    def get_tool_permission(self, tool_name: str) -> ToolPermission | None:
        """Get permission for a specific tool"""
        return self.tool_permissions.get(tool_name)

    def get_resource_permission(self, resource_name: str) -> ResourcePermission | None:
        """Get permission for a specific resource"""
        return self.resource_permissions.get(resource_name)

    def get_prompt_permission(self, prompt_name: str) -> PromptPermission | None:
        """Get permission for a specific prompt"""
        return self.prompt_permissions.get(prompt_name)

    def is_tool_enabled(self, tool_name: str) -> bool:
        """Check if a tool is enabled"""
        permission = self.get_tool_permission(tool_name)
        return permission.get("enabled", False) if permission else False

    def is_resource_enabled(self, resource_name: str) -> bool:
        """Check if a resource is enabled"""
        permission = self.get_resource_permission(resource_name)
        return permission.get("enabled", False) if permission else False

    def is_prompt_enabled(self, prompt_name: str) -> bool:
        """Check if a prompt is enabled"""
        permission = self.get_prompt_permission(prompt_name)
        return permission.get("enabled", False) if permission else False

    def get_all_tools(self) -> dict[str, ToolPermission]:
        """Get all tool permissions"""
        return self.tool_permissions

    def get_all_resources(self) -> dict[str, ResourcePermission]:
        """Get all resource permissions"""
        return self.resource_permissions

    def get_all_prompts(self) -> dict[str, PromptPermission]:
        """Get all prompt permissions"""
        return self.prompt_permissions

    def get_enabled_tools(self) -> dict[str, ToolPermission]:
        """Get only enabled tool permissions"""
        return {
            tool_name: tool_perm
            for tool_name, tool_perm in self.tool_permissions.items()
            if tool_perm.get("enabled", False)
        }

    def get_enabled_resources(self) -> dict[str, ResourcePermission]:
        """Get only enabled resource permissions"""
        return {
            resource_name: resource_perm
            for resource_name, resource_perm in self.resource_permissions.items()
            if resource_perm.get("enabled", False)
        }

    def get_enabled_prompts(self) -> dict[str, PromptPermission]:
        """Get only enabled prompt permissions"""
        return {
            prompt_name: prompt_perm
            for prompt_name, prompt_perm in self.prompt_permissions.items()
            if prompt_perm.get("enabled", False)
        }

    def reload(self) -> None:
        """Reload permissions from files"""
        new_permissions = self.load(self._permissions_dir)
        self.tool_permissions = new_permissions.tool_permissions
        self.resource_permissions = new_permissions.resource_permissions
        self.prompt_permissions = new_permissions.prompt_permissions
        self.tool_metadata = new_permissions.tool_metadata
        self.resource_metadata = new_permissions.resource_metadata
        self.prompt_metadata = new_permissions.prompt_metadata
        log.info("✅ Permissions reloaded from files")


# Load global permissions singleton
permissions = Permissions.load()
