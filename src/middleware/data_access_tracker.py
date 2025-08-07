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
from functools import lru_cache
from pathlib import Path
from typing import Any

from loguru import logger as log


@lru_cache(maxsize=1)
def _load_tool_permissions_cached() -> dict[str, dict[str, bool]]:
    """Load tool permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "tool_permissions.json"

    try:
        if config_path.exists():
            with open(config_path) as f:
                data = json.load(f)
                log.debug(f"Loaded {len(data)} tool permissions from {config_path}")
                return data
        else:
            log.warning(f"Tool permissions file not found at {config_path}")
            return {}
    except Exception as e:
        log.error(f"Failed to load tool permissions from {config_path}: {e}")
        return {}


@lru_cache(maxsize=1)
def _load_resource_permissions_cached() -> dict[str, dict[str, bool]]:
    """Load resource permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "resource_permissions.json"

    try:
        if config_path.exists():
            with open(config_path) as f:
                data = json.load(f)
                log.debug(f"Loaded {len(data)} resource permissions from {config_path}")
                return data
        else:
            log.warning(f"Resource permissions file not found at {config_path}")
            return {}
    except Exception as e:
        log.error(f"Failed to load resource permissions from {config_path}: {e}")
        return {}


@lru_cache(maxsize=1)
def _load_prompt_permissions_cached() -> dict[str, dict[str, bool]]:
    """Load prompt permissions from JSON configuration file with LRU caching."""
    config_path = Path(__file__).parent.parent.parent / "prompt_permissions.json"

    try:
        if config_path.exists():
            with open(config_path) as f:
                data = json.load(f)
                log.debug(f"Loaded {len(data)} prompt permissions from {config_path}")
                return data
        else:
            log.warning(f"Prompt permissions file not found at {config_path}")
            return {}
    except Exception as e:
        log.error(f"Failed to load prompt permissions from {config_path}: {e}")
        return {}


@lru_cache(maxsize=128)
def _classify_tool_permissions_cached(tool_name: str) -> dict[str, bool]:
    """Classify tool permissions with LRU caching."""
    return _classify_permissions_cached(tool_name, _load_tool_permissions_cached(), "tool")


@lru_cache(maxsize=128)
def _classify_resource_permissions_cached(resource_name: str) -> dict[str, bool]:
    """Classify resource permissions with LRU caching."""
    return _classify_permissions_cached(
        resource_name, _load_resource_permissions_cached(), "resource"
    )


@lru_cache(maxsize=128)
def _classify_prompt_permissions_cached(prompt_name: str) -> dict[str, bool]:
    """Classify prompt permissions with LRU caching."""
    return _classify_permissions_cached(prompt_name, _load_prompt_permissions_cached(), "prompt")


def _get_builtin_tool_permissions(name: str) -> dict[str, bool] | None:
    """Get permissions for built-in safe tools."""
    builtin_safe_tools = ["echo", "get_server_info", "get_security_status"]
    if name in builtin_safe_tools:
        permissions = {
            "write_operation": False,
            "read_private_data": False,
            "read_untrusted_public_data": False,
        }
        log.debug(f"Built-in safe tool {name}: {permissions}")
        return permissions
    return None


def _get_exact_match_permissions(
    name: str, permissions_config: dict[str, dict[str, bool]], type_name: str
) -> dict[str, bool] | None:
    """Check for exact match permissions."""
    if name in permissions_config and not name.startswith("_"):
        config_perms = permissions_config[name]
        permissions = {
            "write_operation": config_perms.get("write_operation", False),
            "read_private_data": config_perms.get("read_private_data", False),
            "read_untrusted_public_data": config_perms.get("read_untrusted_public_data", False),
        }
        log.debug(f"Found exact match for {type_name} {name}: {permissions}")
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
    name: str, permissions_config: dict[str, dict[str, bool]], type_name: str
) -> dict[str, bool]:
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
            permissions = {
                "write_operation": config_perms.get("write_operation", False),
                "read_private_data": config_perms.get("read_private_data", False),
                "read_untrusted_public_data": config_perms.get("read_untrusted_public_data", False),
            }
            log.debug(f"Found wildcard match for {type_name} {name} using {pattern}: {permissions}")
            return permissions

    # No configuration found - raise error instead of defaulting to safe
    config_file = f"{type_name}_permissions.json"
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

    def is_trifecta_achieved(self) -> bool:
        """Check if the lethal trifecta has been achieved."""
        return (
            self.has_private_data_access
            and self.has_untrusted_content_exposure
            and self.has_external_communication
        )

    def _load_tool_permissions(self) -> dict[str, dict[str, bool]]:
        """Load tool permissions from JSON configuration file with caching."""
        return _load_tool_permissions_cached()

    def _load_resource_permissions(self) -> dict[str, dict[str, bool]]:
        """Load resource permissions from JSON configuration file with caching."""
        return _load_resource_permissions_cached()

    def _load_prompt_permissions(self) -> dict[str, dict[str, bool]]:
        """Load prompt permissions from JSON configuration file with caching."""
        return _load_prompt_permissions_cached()

    def _classify_by_tool_name(self, tool_name: str) -> dict[str, bool]:
        """Classify permissions based on external JSON configuration only."""
        return _classify_tool_permissions_cached(tool_name)

    def _classify_by_resource_name(self, resource_name: str) -> dict[str, bool]:
        """Classify resource permissions based on external JSON configuration only."""
        return _classify_resource_permissions_cached(resource_name)

    def _classify_by_prompt_name(self, prompt_name: str) -> dict[str, bool]:
        """Classify prompt permissions based on external JSON configuration only."""
        return _classify_prompt_permissions_cached(prompt_name)

    def _classify_tool_permissions(self, tool_name: str) -> dict[str, bool]:
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

    def _classify_resource_permissions(self, resource_name: str) -> dict[str, bool]:
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

    def _classify_prompt_permissions(self, prompt_name: str) -> dict[str, bool]:
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

    def add_tool_call(self, tool_name: str) -> str:
        """
        Add a tool call and update trifecta flags based on tool classification.

        Args:
            tool_name: Name of the tool being called

        Returns:
            Placeholder ID for compatibility

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this call would be blocked
        """
        # Check if trifecta is already achieved before processing this call
        if self.is_trifecta_achieved():
            log.error(f"🚫 BLOCKING tool call {tool_name} - lethal trifecta already achieved")
            raise SecurityError(f"Tool call '{tool_name}' blocked: lethal trifecta achieved")

        # Get tool permissions and update trifecta flags
        permissions = self._classify_tool_permissions(tool_name)

        if permissions["read_private_data"]:
            self.has_private_data_access = True
            log.info(f"🔒 Private data access detected: {tool_name}")

        if permissions["read_untrusted_public_data"]:
            self.has_untrusted_content_exposure = True
            log.info(f"🌐 Untrusted content exposure detected: {tool_name}")

        if permissions["write_operation"]:
            self.has_external_communication = True
            log.info(f"✍️ Write operation detected: {tool_name}")

        # Log if trifecta is achieved after this call
        if self.is_trifecta_achieved():
            log.warning(f"⚠️ LETHAL TRIFECTA ACHIEVED after tool call: {tool_name}")

        return "placeholder_id"

    def add_resource_access(self, resource_name: str) -> str:
        """
        Add a resource access and update trifecta flags based on resource classification.

        Args:
            resource_name: Name/URI of the resource being accessed

        Returns:
            Placeholder ID for compatibility

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this access would be blocked
        """
        # Check if trifecta is already achieved before processing this access
        if self.is_trifecta_achieved():
            log.error(
                f"🚫 BLOCKING resource access {resource_name} - lethal trifecta already achieved"
            )
            raise SecurityError(
                f"Resource access '{resource_name}' blocked: lethal trifecta achieved"
            )

        # Get resource permissions and update trifecta flags
        permissions = self._classify_resource_permissions(resource_name)

        if permissions["read_private_data"]:
            self.has_private_data_access = True
            log.info(f"🔒 Private data access detected via resource: {resource_name}")

        if permissions["read_untrusted_public_data"]:
            self.has_untrusted_content_exposure = True
            log.info(f"🌐 Untrusted content exposure detected via resource: {resource_name}")

        if permissions["write_operation"]:
            self.has_external_communication = True
            log.info(f"✍️ Write operation detected via resource: {resource_name}")

        # Log if trifecta is achieved after this access
        if self.is_trifecta_achieved():
            log.warning(f"⚠️ LETHAL TRIFECTA ACHIEVED after resource access: {resource_name}")

        return "placeholder_id"

    def add_prompt_access(self, prompt_name: str) -> str:
        """
        Add a prompt access and update trifecta flags based on prompt classification.

        Args:
            prompt_name: Name/type of the prompt being accessed

        Returns:
            Placeholder ID for compatibility

        Raises:
            SecurityError: If the lethal trifecta is already achieved and this access would be blocked
        """
        # Check if trifecta is already achieved before processing this access
        if self.is_trifecta_achieved():
            log.error(f"🚫 BLOCKING prompt access {prompt_name} - lethal trifecta already achieved")
            raise SecurityError(f"Prompt access '{prompt_name}' blocked: lethal trifecta achieved")

        # Get prompt permissions and update trifecta flags
        permissions = self._classify_prompt_permissions(prompt_name)

        if permissions["read_private_data"]:
            self.has_private_data_access = True
            log.info(f"🔒 Private data access detected via prompt: {prompt_name}")

        if permissions["read_untrusted_public_data"]:
            self.has_untrusted_content_exposure = True
            log.info(f"🌐 Untrusted content exposure detected via prompt: {prompt_name}")

        if permissions["write_operation"]:
            self.has_external_communication = True
            log.info(f"✍️ Write operation detected via prompt: {prompt_name}")

        # Log if trifecta is achieved after this access
        if self.is_trifecta_achieved():
            log.warning(f"⚠️ LETHAL TRIFECTA ACHIEVED after prompt access: {prompt_name}")

        return "placeholder_id"

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
        }


class SecurityError(Exception):
    """Raised when a security policy violation occurs."""
