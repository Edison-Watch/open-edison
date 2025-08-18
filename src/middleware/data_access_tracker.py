"""
Data Access Tracker for Open Edison

This module defines the DataAccessTracker class that monitors the "lethal trifecta"
of security risks for AI agents: access to private data, exposure to untrusted content,
and ability to externally communicate.

Permissions are loaded from external JSON configuration files that map
names (with server-name/path prefixes) to their security classifications:
- tool_permissions.json: Tool security classifications
- resource_permissions.json: Resource access security classifications
- prompt_permissions.json: Prompt security classifications
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from loguru import logger as log

from src.config import ConfigError
from src.telemetry import (
    record_private_data_access,
    record_prompt_access_blocked,
    record_resource_access_blocked,
    record_tool_call_blocked,
    record_untrusted_public_data,
    record_write_operation,
)

ACL_RANK: dict[str, int] = {"PUBLIC": 0, "PRIVATE": 1, "SECRET": 2}

# Default flat permissions applied when fields are missing in config
DEFAULT_PERMISSIONS: dict[str, Any] = {
    "enabled": False,
    "write_operation": False,
    "read_private_data": False,
    "read_untrusted_public_data": False,
    "acl": "PUBLIC",
}


def _normalize_acl(value: Any, *, default: str = "PUBLIC") -> str:
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
        acl = _normalize_acl(config_perms.get("acl"), default=str(merged["acl"]))
    else:
        acl = _normalize_acl("PRIVATE" if read_private_data else str(merged["acl"]))

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


def _flat_permissions_loader(config_path: Path) -> dict[str, dict[str, Any]]:
    if config_path.exists():
        with open(config_path) as f:
            data: dict[str, Any] = json.load(f)

            # Handle new format: server -> {tool -> permissions}
            # Convert to flat tool -> permissions format
            flat_permissions: dict[str, dict[str, Any]] = {}
            tool_to_server: dict[str, str] = {}
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
                    if not isinstance(tool_permissions, dict):
                        log.warning(
                            f"Invalid tool permissions for {server_name}/{tool_name}: expected dict, got {type(tool_permissions)}"  # type: ignore
                        )  # type: ignore
                        continue

                    # Check for duplicates within the same server
                    if tool_name in server_tools[server_name]:
                        log.error(f"Duplicate tool '{tool_name}' found in server '{server_name}'")
                        raise ConfigError(
                            f"Duplicate tool '{tool_name}' found in server '{server_name}'"
                        )

                    # Check for duplicates across different servers
                    if tool_name in tool_to_server:
                        existing_server = tool_to_server[tool_name]
                        log.error(
                            f"Duplicate tool '{tool_name}' found in servers '{existing_server}' and '{server_name}'"
                        )
                        raise ConfigError(
                            f"Duplicate tool '{tool_name}' found in servers '{existing_server}' and '{server_name}'"
                        )

                    # Add to tracking maps
                    tool_to_server[tool_name] = server_name
                    server_tools[server_name].add(tool_name)  # type: ignore

                    # Convert to flat format with explicit type casting
                    tool_perms_dict: dict[str, Any] = tool_permissions  # type: ignore
                    flat_permissions[tool_name] = _apply_permission_defaults(tool_perms_dict)

            log.debug(
                f"Loaded {len(flat_permissions)} tool permissions from {len(server_tools)} servers in {config_path}"
            )
            # Convert sets to lists for JSON serialization
            server_tools_serializable = {
                server: list(tools) for server, tools in server_tools.items()
            }
            log.debug(f"Server tools: {json.dumps(server_tools_serializable, indent=2)}")
            return flat_permissions
    else:
        log.warning(f"Tool permissions file not found at {config_path}")
        return {}


@cache
def _load_tool_permissions_cached() -> dict[str, dict[str, Any]]:
    """Load tool permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "tool_permissions.json"

    try:
        return _flat_permissions_loader(config_path)
    except ConfigError as e:
        log.error(f"Failed to load tool permissions from {config_path}: {e}")
        raise e
    except Exception as e:
        log.error(f"Failed to load tool permissions from {config_path}: {e}")
        return {}


def clear_tool_permissions_cache() -> None:
    """Clear the tool permissions cache to force reload from file."""
    _load_tool_permissions_cached.cache_clear()
    log.info("Tool permissions cache cleared")


@cache
def _load_resource_permissions_cached() -> dict[str, dict[str, Any]]:
    """Load resource permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "resource_permissions.json"

    try:
        return _flat_permissions_loader(config_path)
    except ConfigError as e:
        log.error(f"Failed to load resource permissions from {config_path}: {e}")
        raise e
    except Exception as e:
        log.error(f"Failed to load resource permissions from {config_path}: {e}")
        return {}


def clear_resource_permissions_cache() -> None:
    """Clear the resource permissions cache to force reload from file."""
    _load_resource_permissions_cached.cache_clear()
    log.info("Resource permissions cache cleared")


@cache
def _load_prompt_permissions_cached() -> dict[str, dict[str, Any]]:
    """Load prompt permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "prompt_permissions.json"

    try:
        return _flat_permissions_loader(config_path)
    except ConfigError as e:
        log.error(f"Failed to load prompt permissions from {config_path}: {e}")
        raise e
    except Exception as e:
        log.error(f"Failed to load prompt permissions from {config_path}: {e}")
        return {}


def clear_prompt_permissions_cache() -> None:
    """Clear the prompt permissions cache to force reload from file."""
    _load_prompt_permissions_cached.cache_clear()
    log.info("Prompt permissions cache cleared")


def clear_all_permissions_caches() -> None:
    """Clear all permission caches to force reload from files."""
    clear_tool_permissions_cache()
    clear_resource_permissions_cache()
    clear_prompt_permissions_cache()
    log.info("All permission caches cleared")


@cache
def _classify_tool_permissions_cached(tool_name: str) -> dict[str, Any]:
    """Classify tool permissions with LRU caching."""
    return _classify_permissions_cached(tool_name, _load_tool_permissions_cached(), "tool")


@cache
def _classify_resource_permissions_cached(resource_name: str) -> dict[str, Any]:
    """Classify resource permissions with LRU caching."""
    return _classify_permissions_cached(
        resource_name, _load_resource_permissions_cached(), "resource"
    )


@cache
def _classify_prompt_permissions_cached(prompt_name: str) -> dict[str, Any]:
    """Classify prompt permissions with LRU caching."""
    return _classify_permissions_cached(prompt_name, _load_prompt_permissions_cached(), "prompt")


def _get_builtin_tool_permissions(name: str) -> dict[str, Any] | None:
    """Get permissions for built-in safe tools."""
    builtin_safe_tools = ["echo", "get_server_info", "get_security_status"]
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


def _classify_permissions_cached(
    name: str, permissions_config: dict[str, dict[str, Any]], type_name: str
) -> dict[str, Any]:
    """Generic permission classification with pattern matching support."""
    # Built-in safe tools that don't need external config (only for tools)
    if type_name == "tool":
        builtin_perms = _get_builtin_tool_permissions(name)
        if builtin_perms is not None:
            return builtin_perms

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


@dataclass
class DataAccessTracker:
    """
    Tracks the "lethal trifecta" of security risks for AI agents.

    The lethal trifecta consists of:
    1. Access to private data (read_private_data)
    2. Exposure to untrusted content (read_untrusted_public_data)
    3. Ability to externally communicate (write_operation)
    """

    # Lethal trifecta flags
    has_private_data_access: bool = False
    has_untrusted_content_exposure: bool = False
    has_external_communication: bool = False
    # ACL tracking: the most restrictive ACL encountered during this session via reads
    highest_acl_level: str = "PUBLIC"

    def is_trifecta_achieved(self) -> bool:
        """Check if the lethal trifecta has been achieved."""
        return (
            self.has_private_data_access
            and self.has_untrusted_content_exposure
            and self.has_external_communication
        )

    def _load_tool_permissions(self) -> dict[str, dict[str, Any]]:
        """Load tool permissions from JSON configuration file with caching."""
        return _load_tool_permissions_cached()

    def _load_resource_permissions(self) -> dict[str, dict[str, Any]]:
        """Load resource permissions from JSON configuration file with caching."""
        return _load_resource_permissions_cached()

    def _load_prompt_permissions(self) -> dict[str, dict[str, Any]]:
        """Load prompt permissions from JSON configuration file with caching."""
        return _load_prompt_permissions_cached()

    def clear_caches(self) -> None:
        """Clear all permission caches to force reload from configuration files."""
        clear_all_permissions_caches()

    def _classify_by_tool_name(self, tool_name: str) -> dict[str, Any]:
        """Classify permissions based on external JSON configuration only."""
        return _classify_tool_permissions_cached(tool_name)

    def _classify_by_resource_name(self, resource_name: str) -> dict[str, Any]:
        """Classify resource permissions based on external JSON configuration only."""
        return _classify_resource_permissions_cached(resource_name)

    def _classify_by_prompt_name(self, prompt_name: str) -> dict[str, Any]:
        """Classify prompt permissions based on external JSON configuration only."""
        return _classify_prompt_permissions_cached(prompt_name)

    def _classify_tool_permissions(self, tool_name: str) -> dict[str, Any]:
        """
        Classify tool permissions based on tool name.

        Args:
            tool_name: Name of the tool to classify
        Returns:
            Dictionary with permission flags
        """
        permissions = self._classify_by_tool_name(tool_name)
        log.debug(f"Classified tool {tool_name}: {permissions}")
        return permissions

    def _classify_resource_permissions(self, resource_name: str) -> dict[str, Any]:
        """
        Classify resource permissions based on resource name.

        Args:
            resource_name: Name/URI of the resource to classify
        Returns:
            Dictionary with permission flags
        """
        permissions = self._classify_by_resource_name(resource_name)
        log.debug(f"Classified resource {resource_name}: {permissions}")
        return permissions

    def _classify_prompt_permissions(self, prompt_name: str) -> dict[str, Any]:
        """
        Classify prompt permissions based on prompt name.

        Args:
            prompt_name: Name/type of the prompt to classify
        Returns:
            Dictionary with permission flags
        """
        permissions = self._classify_by_prompt_name(prompt_name)
        log.debug(f"Classified prompt {prompt_name}: {permissions}")
        return permissions

    def get_tool_permissions(self, tool_name: str) -> dict[str, Any]:
        """Get tool permissions based on tool name."""
        return self._classify_tool_permissions(tool_name)

    def get_resource_permissions(self, resource_name: str) -> dict[str, Any]:
        """Get resource permissions based on resource name."""
        return self._classify_resource_permissions(resource_name)

    def get_prompt_permissions(self, prompt_name: str) -> dict[str, Any]:
        """Get prompt permissions based on prompt name."""
        return self._classify_prompt_permissions(prompt_name)

    def _would_call_complete_trifecta(self, permissions: dict[str, Any]) -> bool:
        """Return True if applying these permissions would complete the trifecta."""
        would_private = self.has_private_data_access or bool(permissions.get("read_private_data"))
        would_untrusted = self.has_untrusted_content_exposure or bool(
            permissions.get("read_untrusted_public_data")
        )
        would_write = self.has_external_communication or bool(permissions.get("write_operation"))
        return bool(would_private and would_untrusted and would_write)

    def _enforce_tool_enabled(self, permissions: dict[str, Any], tool_name: str) -> None:
        if permissions["enabled"] is False:
            log.warning(f"🚫 BLOCKING tool call {tool_name} - tool is disabled")
            record_tool_call_blocked(tool_name, "disabled")
            raise SecurityError(f"'{tool_name}' / Tool disabled")

    def _enforce_acl_downgrade_block(
        self, tool_acl: str, permissions: dict[str, Any], tool_name: str
    ) -> None:
        if permissions["write_operation"]:
            current_rank = ACL_RANK.get(self.highest_acl_level, 0)
            write_rank = ACL_RANK.get(tool_acl, 0)
            if write_rank < current_rank:
                log.error(
                    f"🚫 BLOCKING tool call {tool_name} - write to lower ACL ({tool_acl}) while session has higher ACL {self.highest_acl_level}"
                )
                record_tool_call_blocked(tool_name, "acl_downgrade")
                raise SecurityError(f"'{tool_name}' / ACL (level={self.highest_acl_level})")

    def _apply_permissions_effects(
        self,
        permissions: dict[str, Any],
        *,
        source_type: str,
        name: str,
    ) -> None:
        """Apply side effects (flags, ACL, telemetry) for any source type."""
        acl_value: str = _normalize_acl(permissions.get("acl"), default="PUBLIC")
        if permissions["read_private_data"]:
            self.has_private_data_access = True
            log.info(f"🔒 Private data access detected via {source_type}: {name}")
            record_private_data_access(source_type, name)
            # Update highest ACL based on ACL when reading private data
            current_rank = ACL_RANK.get(self.highest_acl_level, 0)
            new_rank = ACL_RANK.get(acl_value, 0)
            if new_rank > current_rank:
                self.highest_acl_level = acl_value

        if permissions["read_untrusted_public_data"]:
            self.has_untrusted_content_exposure = True
            log.info(f"🌐 Untrusted content exposure detected via {source_type}: {name}")
            record_untrusted_public_data(source_type, name)

        if permissions["write_operation"]:
            self.has_external_communication = True
            log.info(f"✍️ Write operation detected via {source_type}: {name}")
            record_write_operation(source_type, name)

    def add_tool_call(self, tool_name: str):
        """
        Add a tool call and update trifecta flags based on tool classification.

        Args:
            tool_name: Name of the tool being called

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this call would be blocked
        """
        # Check if trifecta is already achieved before processing this call
        if self.is_trifecta_achieved():
            log.error(f"🚫 BLOCKING tool call {tool_name} - lethal trifecta achieved")
            record_tool_call_blocked(tool_name, "trifecta")
            raise SecurityError(f"'{tool_name}' / Lethal trifecta")

        # Get tool permissions and update trifecta flags
        permissions = self._classify_tool_permissions(tool_name)

        log.debug(f"add_tool_call: Tool permissions: {permissions}")

        # Check if tool is enabled
        self._enforce_tool_enabled(permissions, tool_name)

        # ACL-based write downgrade prevention
        tool_acl: str = _normalize_acl(permissions.get("acl"), default="PUBLIC")
        self._enforce_acl_downgrade_block(tool_acl, permissions, tool_name)

        # Pre-check: would this call achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(f"🚫 BLOCKING tool call {tool_name} - would achieve lethal trifecta")
            record_tool_call_blocked(tool_name, "trifecta_prevent")
            raise SecurityError(f"'{tool_name}' / Lethal trifecta")

        self._apply_permissions_effects(permissions, source_type="tool", name=tool_name)

        # We proactively prevent trifecta; by design we should never reach a state where
        # a completed call newly achieves trifecta.

    def add_resource_access(self, resource_name: str):
        """
        Add a resource access and update trifecta flags based on resource classification.

        Args:
            resource_name: Name/URI of the resource being accessed

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this access would be blocked
        """
        # Check if trifecta is already achieved before processing this access
        if self.is_trifecta_achieved():
            log.error(
                f"🚫 BLOCKING resource access {resource_name} - lethal trifecta already achieved"
            )
            raise SecurityError(f"'{resource_name}' / Lethal trifecta")

        # Get resource permissions and update trifecta flags
        permissions = self._classify_resource_permissions(resource_name)

        # Pre-check: would this access achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(
                f"🚫 BLOCKING resource access {resource_name} - would achieve lethal trifecta"
            )
            record_resource_access_blocked(resource_name, "trifecta_prevent")
            raise SecurityError(f"'{resource_name}' / Lethal trifecta")

        self._apply_permissions_effects(permissions, source_type="resource", name=resource_name)

        # We proactively prevent trifecta; by design we should never reach a state where
        # a completed access newly achieves trifecta.

    def add_prompt_access(self, prompt_name: str):
        """
        Add a prompt access and update trifecta flags based on prompt classification.

        Args:
            prompt_name: Name/type of the prompt being accessed

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this access would be blocked
        """
        # Check if trifecta is already achieved before processing this access
        if self.is_trifecta_achieved():
            log.error(f"🚫 BLOCKING prompt access {prompt_name} - lethal trifecta already achieved")
            raise SecurityError(f"'{prompt_name}' / Lethal trifecta")

        # Get prompt permissions and update trifecta flags
        permissions = self._classify_prompt_permissions(prompt_name)

        # Pre-check: would this access achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(f"🚫 BLOCKING prompt access {prompt_name} - would achieve lethal trifecta")
            record_prompt_access_blocked(prompt_name, "trifecta_prevent")
            raise SecurityError(f"'{prompt_name}' / Lethal trifecta")

        self._apply_permissions_effects(permissions, source_type="prompt", name=prompt_name)

        # We proactively prevent trifecta; by design we should never reach a state where
        # a completed access newly achieves trifecta.

    def to_dict(self) -> dict[str, Any]:
        """
        Convert tracker to dictionary for serialization.

        Returns:
            Dictionary representation of the tracker
        """
        return {
            "lethal_trifecta": {
                "has_private_data_access": self.has_private_data_access,
                "has_untrusted_content_exposure": self.has_untrusted_content_exposure,
                "has_external_communication": self.has_external_communication,
                "trifecta_achieved": self.is_trifecta_achieved(),
            },
            "acl": {
                "highest_acl_level": self.highest_acl_level,
            },
        }


class SecurityError(Exception):
    """Raised when a security policy violation occurs."""

    def __init__(self, message: str):
        """We format with a brick ascii wall"""
        message = f"""
 ████ ████ ████ ████ ████ ████
 ██ ████ ████ ████ ████ ████ █
 ████ ████ ████ ████ ████ ████
       BLOCKED BY EDISON
 {message:^30}
 ████ ████ ████ ████ ████ ████
 ██ ████ ████ ████ ████ ████ █
 ████ ████ ████ ████ ████ ████
"""
        super().__init__(message)
