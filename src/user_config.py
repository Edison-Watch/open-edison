import json
from functools import cache
from pathlib import Path
from typing import Any

from loguru import logger as log

from src.config import ConfigError, get_config_dir

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
        config_perms.get("read_untrusted_public_data", merged["read_untrusted_public_data"])  # type: ignore[reportUnknownArgumentType]
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


# This is the only function that should have cache, and we clear it only when we want to reload configs.
@cache
def _flat_permissions_loader(config_path: Path) -> dict[str, dict[str, Any]]:
    if not config_path.exists():
        raise ConfigError(f"Permissions file not found at {config_path}")

    with open(config_path) as f:
        log.debug(f"Loading permissions from {config_path}")
        data: dict[str, Any] = json.load(f)

    # Handle new format: server -> {tool -> permissions}
    # Convert to flat tool -> permissions format
    flat_permissions: dict[str, dict[str, Any]] = {}
    server_tools: dict[str, set[str]] = {}

    for server_name, server_data in data.items():
        if not isinstance(server_data, dict):
            log.warning(
                f"Invalid server data for {server_name}: expected dict, got {type(server_data)}"
            )
            continue

        if server_name == "_metadata":
            flat_permissions["_metadata"] = server_data
            continue

        server_tools[server_name] = set()

        for tool_name, tool_permissions in server_data.items():  # type: ignore
            # Prefix by server name to make things clear
            assert isinstance(tool_name, str)
            unprefixed_tool_name = tool_name
            tool_name = server_name + "_" + tool_name
            if not isinstance(tool_permissions, dict):
                log.warning(
                    f"Invalid tool permissions for {tool_name}: expected dict, got {type(tool_permissions)}"  # type: ignore
                )  # type: ignore
                continue

            # Check for duplicates within the same server
            if tool_name in server_tools[server_name]:
                log.error(
                    f"Duplicate tool '{unprefixed_tool_name}' found in server '{server_name}'"
                )
                raise ConfigError(
                    f"Duplicate tool '{unprefixed_tool_name}' found in server '{server_name}'"
                )

            server_tools[server_name].add(unprefixed_tool_name)  # type: ignore

            # Convert to flat format with explicit type casting
            tool_perms_dict: dict[str, Any] = tool_permissions  # type: ignore
            flat_permissions[tool_name] = _apply_permission_defaults(tool_perms_dict)

    log.trace(
        f"Loaded {len(flat_permissions)} tool permissions from {len(server_tools)} servers in {config_path}"
    )
    # Convert sets to lists for JSON serialization
    server_tools_serializable = {server: list(tools) for server, tools in server_tools.items()}
    log.trace(f"Server tools: {json.dumps(server_tools_serializable, indent=2)}")
    return flat_permissions


def clear_config_cache() -> None:
    """Clear the config cache to force reload from file."""
    _flat_permissions_loader.cache_clear()
    log.info("Config cache cleared")


def _classify_tool_permissions(tool_name: str) -> dict[str, Any]:
    """Classify tool permissions with LRU caching."""
    config_path = get_config_dir() / "tool_permissions.json"
    config = _flat_permissions_loader(config_path)
    return _classify_permissions_cached(tool_name, config, "tool")


def _classify_resource_permissions(resource_name: str) -> dict[str, Any]:
    """Classify resource permissions with LRU caching."""
    config_path = get_config_dir() / "resource_permissions.json"
    config = _flat_permissions_loader(config_path)
    return _classify_permissions_cached(resource_name, config, "resource")


def _classify_prompt_permissions(prompt_name: str) -> dict[str, Any]:
    """Classify prompt permissions with LRU caching."""
    config_path = get_config_dir() / "prompt_permissions.json"
    config = _flat_permissions_loader(config_path)
    return _classify_permissions_cached(prompt_name, config, "prompt")


def _get_exact_match_permissions(
    name: str, permissions_config: dict[str, dict[str, Any]], type_name: str
) -> dict[str, Any] | None:
    """Check for exact match permissions."""
    if name in permissions_config and not name.startswith("_"):
        config_perms = permissions_config[name]
        permissions = _apply_permission_defaults(config_perms)
        log.trace(f"Found exact match for {type_name} {name}: {permissions}")
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


def _classify_permissions_cached(
    name: str, permissions_config: dict[str, dict[str, Any]], type_name: str
) -> dict[str, Any]:
    """Generic permission classification with pattern matching support."""
    # Check for exact match first
    exact_perms = _get_exact_match_permissions(name, permissions_config, type_name)
    if exact_perms is not None:
        return exact_perms

    # Try wildcard patterns
    wildcard_patterns = _get_wildcard_patterns(name, type_name)
    for pattern in wildcard_patterns:
        if pattern in permissions_config:
            config_perms = permissions_config[pattern]
            permissions = _apply_permission_defaults(config_perms)
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


def classify_tool_permissions(tool_name: str) -> dict[str, Any]:
    """
    Classify tool permissions based on tool name.

    Args:
        tool_name: Name of the tool to classify
    Returns:
        Dictionary with permission flags
    """
    permissions = _classify_tool_permissions(tool_name)
    log.trace(f"Classified tool {tool_name}: {permissions}")
    return permissions


def classify_resource_permissions(resource_name: str) -> dict[str, Any]:
    """
    Classify resource permissions based on resource name.

    Args:
        resource_name: Name/URI of the resource to classify
    Returns:
        Dictionary with permission flags
    """
    permissions = _classify_resource_permissions(resource_name)
    log.trace(f"Classified resource {resource_name}: {permissions}")
    return permissions


def classify_prompt_permissions(prompt_name: str) -> dict[str, Any]:
    """
    Classify prompt permissions based on prompt name.

    Args:
        prompt_name: Name/type of the prompt to classify
    Returns:
        Dictionary with permission flags
    """
    permissions = _classify_prompt_permissions(prompt_name)
    log.trace(f"Classified prompt {prompt_name}: {permissions}")
    return permissions
