"""
Permissions management for Open Edison

Simple JSON-based permissions for single-user MCP proxy.
Reads tool, resource, and prompt permission files and provides a singleton interface.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from loguru import logger as log

from src.config import get_config_dir

# Detect repository root (same logic as in src.config)
_ROOT_DIR = Path(__file__).parent.parent


def _default_permissions_dir() -> Path:
    """Resolve default permissions directory.

    In development (repo checkout with pyproject.toml), prefer repository root so
    we use repo-local tool/resource/prompt permissions JSON files. Otherwise fall
    back to the standard user config directory.
    """
    try:
        if (_ROOT_DIR / "pyproject.toml").exists():
            return _ROOT_DIR
    except Exception:
        pass
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


@dataclass
class PromptPermission:
    """Individual prompt permission configuration"""

    enabled: bool = False
    write_operation: bool = False
    read_private_data: bool = False
    read_untrusted_public_data: bool = False


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
            raise PermissionsError(f"Permissions file not found at {file_path}")

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

    def get_tool_permission(self, tool_name: str) -> ToolPermission:
        """Get permission for a specific tool"""
        if tool_name not in self.tool_permissions:
            raise PermissionsError(f"Tool '{tool_name}' not found in permissions")
        return self.tool_permissions[tool_name]

    def get_resource_permission(self, resource_name: str) -> ResourcePermission:
        """Get permission for a specific resource"""
        if resource_name not in self.resource_permissions:
            raise PermissionsError(f"Resource '{resource_name}' not found in permissions")
        return self.resource_permissions[resource_name]

    def get_prompt_permission(self, prompt_name: str) -> PromptPermission:
        """Get permission for a specific prompt"""
        if prompt_name not in self.prompt_permissions:
            raise PermissionsError(f"Prompt '{prompt_name}' not found in permissions")
        return self.prompt_permissions[prompt_name]

    def is_tool_enabled(self, tool_name: str) -> bool:
        """Check if a tool is enabled"""
        permission = self.get_tool_permission(tool_name)
        return permission.enabled

    def is_resource_enabled(self, resource_name: str) -> bool:
        """Check if a resource is enabled"""
        permission = self.get_resource_permission(resource_name)
        return permission.enabled

    def is_prompt_enabled(self, prompt_name: str) -> bool:
        """Check if a prompt is enabled"""
        permission = self.get_prompt_permission(prompt_name)
        return permission.enabled

    def reload(self) -> None:
        """Reload permissions from files"""
        new_permissions = Permissions.load(self._permissions_dir)
        self.tool_permissions = new_permissions.tool_permissions
        self.resource_permissions = new_permissions.resource_permissions
        self.prompt_permissions = new_permissions.prompt_permissions
        self.tool_metadata = new_permissions.tool_metadata
        self.resource_metadata = new_permissions.resource_metadata
        self.prompt_metadata = new_permissions.prompt_metadata
        log.info("✅ Permissions reloaded from files")


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


# Load global permissions singleton
permissions = Permissions.load()
