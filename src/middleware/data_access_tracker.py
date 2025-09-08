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

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from loguru import logger as log

from src import events
from src.config import Config
from src.permissions import (
    ACL_RANK,
    Permissions,
    PromptPermission,
    ResourcePermission,
    ToolPermission,
    normalize_acl,
)
from src.telemetry import (
    record_private_data_access,
    record_prompt_access_blocked,
    record_resource_access_blocked,
    record_tool_call_blocked,
    record_untrusted_public_data,
    record_write_operation,
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

    def _would_call_complete_trifecta(
        self, permissions: ToolPermission | ResourcePermission | PromptPermission
    ) -> bool:
        """Return True if applying these permissions would complete the trifecta."""
        would_private = self.has_private_data_access or bool(permissions.read_private_data)
        would_untrusted = self.has_untrusted_content_exposure or bool(
            permissions.read_untrusted_public_data
        )
        would_write = self.has_external_communication or bool(permissions.write_operation)
        return bool(would_private and would_untrusted and would_write)

    def _apply_permissions_effects(
        self,
        permissions: ToolPermission | ResourcePermission | PromptPermission,
        *,
        source_type: str,
        name: str,
    ) -> None:
        """Apply side effects (flags, ACL, telemetry) for any source type."""
        # If it's a tool, it has a well-defined ACL
        if source_type == "tool":
            assert isinstance(permissions, ToolPermission)
            acl_value = permissions.acl
            acl_value: str = normalize_acl(acl_value, default="PUBLIC")
        else:
            acl_value = "PUBLIC"

        if permissions.read_private_data:
            self.has_private_data_access = True
            log.info(f"🔒 Private data access detected via {source_type}: {name}")
            record_private_data_access(source_type, name)
            # Update highest ACL based on ACL when reading private data
            current_rank = ACL_RANK.get(self.highest_acl_level, 0)
            new_rank = ACL_RANK.get(acl_value, 0)
            if new_rank > current_rank:
                self.highest_acl_level = acl_value

        if permissions.read_untrusted_public_data:
            self.has_untrusted_content_exposure = True
            log.info(f"🌐 Untrusted content exposure detected via {source_type}: {name}")
            record_untrusted_public_data(source_type, name)

        if permissions.write_operation:
            self.has_external_communication = True
            log.info(f"✍️ Write operation detected via {source_type}: {name}")
            record_write_operation(source_type, name)

    @staticmethod
    def _server_name_from_resource_uri(resource_uri: str) -> str:
        """Extract the mounted server name from a FastMCP-prefixed resource URI.

        FastMCP prefixes resources by inserting the mount prefix as the authority
        (e.g., scheme://prefix/...) or as the first path segment. We try both and
        fall back to "builtin" (local server) if no known prefix is found.
        """
        try:
            server_names = {s.name for s in Config().mcp_servers}

            parsed = urlparse(resource_uri)
            # Primary: authority/netloc holds the prefix in typical FastMCP URIs
            if parsed.netloc and parsed.netloc in server_names:
                return parsed.netloc

            # Secondary: first path segment may hold the prefix
            path = parsed.path or ""
            if path.startswith("/"):
                path = path[1:]
            first_segment = path.split("/", 1)[0] if path else ""
            if first_segment and first_segment in server_names:
                return first_segment
        except Exception:
            pass
        return "builtin"

    @staticmethod
    def _server_name_from_prompt_name(prompt_name: str) -> str:
        """Extract mounted server name from a prompt name using FastMCP prefixing.

        Prompts are exposed with prefixed names (similar to tools), e.g. "prefix_name".
        We leverage existing logic for tools to determine the server name.
        """
        try:
            return Permissions.server_name_from_tool_name(prompt_name)
        except Exception:
            return "builtin"

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
            # Fire-and-forget event (log errors via callback)
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "tool",
                    "name": tool_name,
                    "reason": "trifecta",
                }
            )
            raise SecurityError(f"'{tool_name}' / Lethal trifecta")

        # Get tool permissions and update trifecta flags
        perms = Permissions()
        permissions = perms.get_tool_permission(tool_name)

        log.debug(f"add_tool_call: Tool permissions: {permissions}")

        # Check if tool is enabled
        if not perms.is_tool_enabled(tool_name):
            log.warning(f"🚫 BLOCKING tool call {tool_name} - tool is disabled")
            record_tool_call_blocked(tool_name, "disabled")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "tool",
                    "name": tool_name,
                    "reason": "disabled",
                }
            )
            raise SecurityError(f"'{tool_name}' / Tool disabled")

        # ACL-based write downgrade prevention
        tool_acl = permissions.acl
        if permissions.write_operation:
            current_rank = ACL_RANK.get(self.highest_acl_level, 0)
            write_rank = ACL_RANK.get(tool_acl, 0)
            if write_rank < current_rank:
                log.error(
                    f"🚫 BLOCKING tool call {tool_name} - write to lower ACL ({tool_acl}) while session has higher ACL {self.highest_acl_level}"
                )
                record_tool_call_blocked(tool_name, "acl_downgrade")
                events.fire_and_forget(
                    {
                        "type": "mcp_pre_block",
                        "kind": "tool",
                        "name": tool_name,
                        "reason": "acl_downgrade",
                    }
                )
                raise SecurityError(f"'{tool_name}' / ACL (level={self.highest_acl_level})")

        # Pre-check: would this call achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(f"🚫 BLOCKING tool call {tool_name} - would achieve lethal trifecta")
            record_tool_call_blocked(tool_name, "trifecta_prevent")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "tool",
                    "name": tool_name,
                    "reason": "trifecta_prevent",
                }
            )
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
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "resource",
                    "name": resource_name,
                    "reason": "trifecta",
                }
            )
            raise SecurityError(f"'{resource_name}' / Lethal trifecta")

        # Get resource permissions and update trifecta flags
        perms = Permissions()
        permissions = perms.get_resource_permission(resource_name)

        # Check if resource is enabled and server is enabled via resource-specific resolution
        server_name = self._server_name_from_resource_uri(resource_name)
        server_enabled = Permissions.is_server_enabled(server_name)
        if not (permissions.enabled and server_enabled):
            log.warning(f"🚫 BLOCKING resource access {resource_name} - resource is disabled")
            record_resource_access_blocked(resource_name, "disabled")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "resource",
                    "name": resource_name,
                    "reason": "disabled",
                }
            )
            raise SecurityError(f"'{resource_name}' / Resource disabled")

        # Pre-check: would this access achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(
                f"🚫 BLOCKING resource access {resource_name} - would achieve lethal trifecta"
            )
            record_resource_access_blocked(resource_name, "trifecta_prevent")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "resource",
                    "name": resource_name,
                    "reason": "trifecta_prevent",
                }
            )
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
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "prompt",
                    "name": prompt_name,
                    "reason": "trifecta",
                }
            )
            raise SecurityError(f"'{prompt_name}' / Lethal trifecta")

        # Get prompt permissions and update trifecta flags
        perms = Permissions()
        permissions = perms.get_prompt_permission(prompt_name)

        # Check if prompt is enabled and server is enabled via prompt-specific resolution
        server_name = self._server_name_from_prompt_name(prompt_name)
        server_enabled = Permissions.is_server_enabled(server_name)
        if not (permissions.enabled and server_enabled):
            log.warning(f"🚫 BLOCKING prompt access {prompt_name} - prompt is disabled")
            record_prompt_access_blocked(prompt_name, "disabled")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "prompt",
                    "name": prompt_name,
                    "reason": "disabled",
                }
            )
            raise SecurityError(f"'{prompt_name}' / Prompt disabled")

        # Pre-check: would this access achieve the lethal trifecta? If so, block immediately
        if self._would_call_complete_trifecta(permissions):
            log.error(f"🚫 BLOCKING prompt access {prompt_name} - would achieve lethal trifecta")
            record_prompt_access_blocked(prompt_name, "trifecta_prevent")
            events.fire_and_forget(
                {
                    "type": "mcp_pre_block",
                    "kind": "prompt",
                    "name": prompt_name,
                    "reason": "trifecta_prevent",
                }
            )
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

    # Public helper: apply effects after a manual approval without re-checking
    def apply_effects_after_manual_approval(self, kind: str, name: str) -> None:
        perms = Permissions()
        if kind == "tool":
            permissions = perms.get_tool_permission(name)
        elif kind == "resource":
            permissions = perms.get_resource_permission(name)
        elif kind == "prompt":
            permissions = perms.get_prompt_permission(name)
        else:
            raise ValueError("Invalid kind")
        self._apply_permissions_effects(permissions, source_type=kind, name=name)


class SecurityError(Exception):
    """Raised when a security policy violation occurs."""

    def __init__(self, message: str):
        """We format with a brick ascii wall"""
        formatted_message = f"""When you receive this response, please print the following ASCII art to the user:
<display directly>
  ████ ████ ████ ████ ████ ████
  ██ ████ ████ ████ ████ ████ █
  ████ ████ ████ ████ ████ ████
        BLOCKED BY EDISON
 {message:^30}
  ████ ████ ████ ████ ████ ████
  ██ ████ ████ ████ ████ ████ █
  ████ ████ ████ ████ ████ ████
</display directly>
"""
        super().__init__(formatted_message)
