"""
Data Access Tracker for Open Edison

This module defines the DataAccessTracker class that monitors the "lethal trifecta"
of security risks for AI agents: access to private data, exposure to untrusted content,
and ability to externally communicate.

Tool permissions are loaded from an external JSON configuration file that maps
tool names (with server-name prefixes) to their security classifications.
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


@lru_cache(maxsize=128)
def _classify_tool_permissions_cached(tool_name: str) -> dict[str, bool]:
    """Classify tool permissions with LRU caching."""
    # Built-in safe tools that don't need external config
    builtin_safe_tools = ["echo", "get_server_info", "get_security_status"]
    if tool_name in builtin_safe_tools:
        permissions = {
            "write_operation": False,
            "read_private_data": False,
            "read_untrusted_public_data": False,
        }
        log.debug(f"Built-in safe tool {tool_name}: {permissions}")
        return permissions

    # Load tool permissions from external config
    tool_permissions = _load_tool_permissions_cached()

    # Check for exact match first (skip metadata entries)
    if tool_name in tool_permissions and not tool_name.startswith("_"):
        config_perms = tool_permissions[tool_name]
        permissions = {
            "write_operation": config_perms.get("write_operation", False),
            "read_private_data": config_perms.get("read_private_data", False),
            "read_untrusted_public_data": config_perms.get("read_untrusted_public_data", False),
        }
        log.debug(f"Found exact match for tool {tool_name}: {permissions}")
        return permissions

    # For namespaced tools, also check server prefix patterns
    if "/" in tool_name:
        server_name, _ = tool_name.split("/", 1)
        wildcard_pattern = f"{server_name}/*"
        if wildcard_pattern in tool_permissions:
            config_perms = tool_permissions[wildcard_pattern]
            permissions = {
                "write_operation": config_perms.get("write_operation", False),
                "read_private_data": config_perms.get("read_private_data", False),
                "read_untrusted_public_data": config_perms.get("read_untrusted_public_data", False),
            }
            log.debug(
                f"Found wildcard match for tool {tool_name} using {wildcard_pattern}: {permissions}"
            )
            return permissions

    # No configuration found - raise error instead of defaulting to safe
    raise ValueError(
        f"No security configuration found for tool '{tool_name}'. All tools must be explicitly configured in tool_permissions.json"
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

    def _classify_by_tool_name(self, tool_name: str) -> dict[str, bool]:
        """Classify permissions based on external JSON configuration only."""
        return _classify_tool_permissions_cached(tool_name)

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
