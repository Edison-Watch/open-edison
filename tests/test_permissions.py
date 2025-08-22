"""
Tests for the Permissions class

Tests the main permissions management system that handles tools, resources, and prompts
with separate JSON configuration files for each type.
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.permissions import (
    DEFAULT_PERMISSIONS,
    Permissions,
    PermissionsError,
    apply_permission_defaults,
    normalize_acl,
)


class TestNormalizeAcl:
    """Test ACL normalization functionality."""

    def test_normalize_acl_valid_values(self):
        """Test that valid ACL values are normalized correctly."""
        assert normalize_acl("public") == "PUBLIC"
        assert normalize_acl("PRIVATE") == "PRIVATE"
        assert normalize_acl("secret") == "SECRET"
        assert normalize_acl(" PUBLIC ") == "PUBLIC"

    def test_normalize_acl_invalid_values(self):
        """Test that invalid ACL values default to PUBLIC."""
        assert normalize_acl("invalid") == "PUBLIC"
        assert normalize_acl("UNKNOWN") == "PUBLIC"
        assert normalize_acl("") == "PUBLIC"

    def test_normalize_acl_none_values(self):
        """Test that None values default to PUBLIC."""
        assert normalize_acl(None) == "PUBLIC"
        assert normalize_acl(None, default="PRIVATE") == "PRIVATE"

    def test_normalize_acl_custom_default(self):
        """Test that custom defaults work correctly."""
        assert normalize_acl("invalid", default="PRIVATE") == "PRIVATE"
        assert normalize_acl(None, default="SECRET") == "SECRET"


class TestApplyPermissionDefaults:
    """Test permission defaults application."""

    def test_apply_permission_defaults_empty(self):
        """Test applying defaults to empty config."""
        result = apply_permission_defaults({})
        assert result == DEFAULT_PERMISSIONS

    def test_apply_permission_defaults_partial(self):
        """Test applying defaults to partial config."""
        config = {"enabled": True, "write_operation": True}
        result = apply_permission_defaults(config)

        assert result["enabled"] is True
        assert result["write_operation"] is True
        assert result["read_private_data"] is False  # Default
        assert result["read_untrusted_public_data"] is False  # Default
        assert result["acl"] == "PUBLIC"  # Default

    def test_apply_permission_defaults_acl_derivation(self):
        """Test ACL derivation based on read_private_data."""
        # When read_private_data is True, ACL should default to PRIVATE
        config = {"read_private_data": True}
        result = apply_permission_defaults(config)
        assert result["acl"] == "PRIVATE"

        # When read_private_data is False, ACL should default to PUBLIC
        config = {"read_private_data": False}
        result = apply_permission_defaults(config)
        assert result["acl"] == "PUBLIC"

    def test_apply_permission_defaults_explicit_acl(self):
        """Test that explicit ACL values take precedence."""
        config = {"read_private_data": True, "acl": "SECRET"}
        result = apply_permission_defaults(config)
        assert result["acl"] == "SECRET"

    def test_apply_permission_defaults_boolean_conversion(self):
        """Test that boolean values are properly converted."""
        config = {
            "enabled": True,
            "write_operation": True,
            "read_private_data": False,
            "read_untrusted_public_data": False,
        }
        result = apply_permission_defaults(config)

        assert result["enabled"] is True
        assert result["write_operation"] is True
        assert result["read_private_data"] is False
        assert result["read_untrusted_public_data"] is False


class TestPermissionsLoad:
    """Test permissions loading functionality."""

    def test_load_with_valid_files(self):
        """Test loading permissions with valid JSON files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create test permission files
            tool_perms = {
                "_metadata": {"description": "Test tool permissions", "last_updated": "2025-01-01"},
                "server1": {
                    "tool1": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                        "acl": "PRIVATE",
                    }
                },
            }

            resource_perms = {
                "_metadata": {
                    "description": "Test resource permissions",
                    "last_updated": "2025-01-01",
                },
                "server1": {
                    "resource1": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": False,
                        "read_untrusted_public_data": False,
                    }
                },
            }

            prompt_perms = {
                "_metadata": {
                    "description": "Test prompt permissions",
                    "last_updated": "2025-01-01",
                },
                "server1": {
                    "prompt1": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": False,
                        "read_untrusted_public_data": False,
                    }
                },
            }

            # Write files
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps(resource_perms))
            (temp_path / "prompt_permissions.json").write_text(json.dumps(prompt_perms))

            # Load permissions
            permissions = Permissions.load(temp_path)

            # Verify structure
            assert isinstance(permissions, Permissions)
            assert "tool1" in permissions.tool_permissions
            assert "resource1" in permissions.resource_permissions
            assert "prompt1" in permissions.prompt_permissions

            # Verify metadata
            assert permissions.tool_metadata is not None
            assert permissions.tool_metadata.description == "Test tool permissions"
            assert permissions.resource_metadata is not None
            assert permissions.prompt_metadata is not None

    def test_load_with_missing_files(self):
        """Test loading permissions when some files are missing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Only create tool permissions file
            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))

            # Load permissions (should not raise error)
            permissions = Permissions.load(temp_path)

            assert isinstance(permissions, Permissions)
            assert len(permissions.tool_permissions) == 1
            assert len(permissions.resource_permissions) == 0
            assert len(permissions.prompt_permissions) == 0

    def test_load_with_duplicate_items_different_servers(self):
        """Test that duplicate items across different servers raise error."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
                "server2": {
                    "tool1": {"enabled": False}  # Same name, different server
                },
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Should raise PermissionsError due to duplicate
            with pytest.raises(PermissionsError, match="Duplicate item"):
                Permissions.load(temp_path)

    def test_load_with_invalid_json(self):
        """Test loading with invalid JSON files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create invalid JSON file
            (temp_path / "tool_permissions.json").write_text('{"invalid": json}')
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Should raise JSONDecodeError
            with pytest.raises(json.JSONDecodeError):
                Permissions.load(temp_path)

    def test_load_with_invalid_server_data(self):
        """Test loading with invalid server data structure."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": "invalid_data",  # Should be dict, not string
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Should load successfully but skip invalid data
            permissions = Permissions.load(temp_path)
            assert len(permissions.tool_permissions) == 0

    def test_load_with_invalid_item_data(self):
        """Test loading with invalid item data structure."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {
                    "tool1": "invalid_data"  # Should be dict, not string
                },
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Should load successfully but skip invalid data
            permissions = Permissions.load(temp_path)
            assert len(permissions.tool_permissions) == 0


class TestPermissionsLoadTwice:
    """Test loading permissions twice (as requested by user)."""

    def test_load_twice_same_directory(self):
        """Test loading permissions twice from the same directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create initial permission files
            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Load first time
            permissions1 = Permissions.load(temp_path)
            assert len(permissions1.tool_permissions) == 1
            assert "tool1" in permissions1.tool_permissions

            # Load second time
            permissions2 = Permissions.load(temp_path)
            assert len(permissions2.tool_permissions) == 1
            assert "tool1" in permissions2.tool_permissions

            # Should be different instances but same content
            assert permissions1 is not permissions2
            assert permissions1.tool_permissions == permissions2.tool_permissions

    def test_load_twice_different_content(self):
        """Test loading permissions twice with different content."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create initial permission files
            tool_perms1 = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms1))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Load first time
            permissions1 = Permissions.load(temp_path)
            assert len(permissions1.tool_permissions) == 1

            # Update the file
            tool_perms2 = {
                "_metadata": {"description": "Test Updated", "last_updated": "2025-01-02"},
                "server1": {"tool1": {"enabled": False}, "tool2": {"enabled": True}},
            }
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms2))

            # Load second time
            permissions2 = Permissions.load(temp_path)
            assert len(permissions2.tool_permissions) == 2
            assert permissions2.tool_permissions["tool1"]["enabled"] is False
            assert permissions2.tool_permissions["tool2"]["enabled"] is True

            # Should be different content
            assert permissions1.tool_permissions != permissions2.tool_permissions


class TestPermissionsReload:
    """Test permissions reload functionality."""

    def test_reload_with_updated_files(self):
        """Test reloading permissions with updated files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create initial permission files
            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Load permissions
            permissions = Permissions.load(temp_path)
            assert len(permissions.tool_permissions) == 1
            assert permissions.tool_permissions["tool1"]["enabled"] is True

            # Update the file
            updated_tool_perms = {
                "_metadata": {"description": "Test Updated", "last_updated": "2025-01-02"},
                "server1": {"tool1": {"enabled": False}, "tool2": {"enabled": True}},
            }
            (temp_path / "tool_permissions.json").write_text(json.dumps(updated_tool_perms))

            # Reload permissions
            permissions.reload()

            # Verify changes
            assert len(permissions.tool_permissions) == 2
            assert permissions.tool_permissions["tool1"]["enabled"] is False
            assert permissions.tool_permissions["tool2"]["enabled"] is True

    def test_reload_with_deleted_files(self):
        """Test reloading permissions when files are deleted."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create initial permission files
            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Load permissions
            permissions = Permissions.load(temp_path)
            assert len(permissions.tool_permissions) == 1

            # Delete the tool permissions file
            (temp_path / "tool_permissions.json").unlink()

            # Reload permissions
            permissions.reload()

            # Should have empty tool permissions
            assert len(permissions.tool_permissions) == 0

    def test_reload_preserves_instance(self):
        """Test that reload preserves the same instance."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create initial permission files
            tool_perms = {
                "_metadata": {"description": "Test", "last_updated": "2025-01-01"},
                "server1": {"tool1": {"enabled": True}},
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            # Load permissions
            permissions = Permissions.load(temp_path)
            original_id = id(permissions)

            # Update and reload
            updated_tool_perms = {
                "_metadata": {"description": "Test Updated", "last_updated": "2025-01-02"},
                "server1": {"tool2": {"enabled": True}},
            }
            (temp_path / "tool_permissions.json").write_text(json.dumps(updated_tool_perms))

            permissions.reload()

            # Should be the same instance
            assert id(permissions) == original_id
            assert len(permissions.tool_permissions) == 1
            assert "tool2" in permissions.tool_permissions


class TestPermissionsAccessors:
    """Test permission accessor methods."""

    def test_get_tool_permission(self):
        """Test getting tool permissions."""
        permissions = Permissions(
            tool_permissions={
                "tool1": {"enabled": True, "write_operation": False},
                "tool2": {"enabled": False, "write_operation": True},
            },
            resource_permissions={},
            prompt_permissions={},
        )

        # Test existing tool
        tool1_perm = permissions.get_tool_permission("tool1")
        assert tool1_perm is not None
        assert tool1_perm["enabled"] is True

        # Test non-existing tool
        assert permissions.get_tool_permission("nonexistent") is None

    def test_get_resource_permission(self):
        """Test getting resource permissions."""
        permissions = Permissions(
            tool_permissions={},
            resource_permissions={
                "resource1": {"enabled": True, "write_operation": False},
                "resource2": {"enabled": False, "write_operation": True},
            },
            prompt_permissions={},
        )

        # Test existing resource
        resource1_perm = permissions.get_resource_permission("resource1")
        assert resource1_perm is not None
        assert resource1_perm["enabled"] is True

        # Test non-existing resource
        assert permissions.get_resource_permission("nonexistent") is None

    def test_get_prompt_permission(self):
        """Test getting prompt permissions."""
        permissions = Permissions(
            tool_permissions={},
            resource_permissions={},
            prompt_permissions={
                "prompt1": {"enabled": True, "write_operation": False},
                "prompt2": {"enabled": False, "write_operation": True},
            },
        )

        # Test existing prompt
        prompt1_perm = permissions.get_prompt_permission("prompt1")
        assert prompt1_perm is not None
        assert prompt1_perm["enabled"] is True

        # Test non-existing prompt
        assert permissions.get_prompt_permission("nonexistent") is None

    def test_is_tool_enabled(self):
        """Test checking if tools are enabled."""
        permissions = Permissions(
            tool_permissions={
                "enabled_tool": {"enabled": True},
                "disabled_tool": {"enabled": False},
                "no_enabled_field": {"write_operation": True},
            },
            resource_permissions={},
            prompt_permissions={},
        )

        assert permissions.is_tool_enabled("enabled_tool") is True
        assert permissions.is_tool_enabled("disabled_tool") is False
        assert permissions.is_tool_enabled("no_enabled_field") is False
        assert permissions.is_tool_enabled("nonexistent") is False

    def test_is_resource_enabled(self):
        """Test checking if resources are enabled."""
        permissions = Permissions(
            tool_permissions={},
            resource_permissions={
                "enabled_resource": {"enabled": True},
                "disabled_resource": {"enabled": False},
                "no_enabled_field": {"write_operation": True},
            },
            prompt_permissions={},
        )

        assert permissions.is_resource_enabled("enabled_resource") is True
        assert permissions.is_resource_enabled("disabled_resource") is False
        assert permissions.is_resource_enabled("no_enabled_field") is False
        assert permissions.is_resource_enabled("nonexistent") is False

    def test_is_prompt_enabled(self):
        """Test checking if prompts are enabled."""
        permissions = Permissions(
            tool_permissions={},
            resource_permissions={},
            prompt_permissions={
                "enabled_prompt": {"enabled": True},
                "disabled_prompt": {"enabled": False},
                "no_enabled_field": {"write_operation": True},
            },
        )

        assert permissions.is_prompt_enabled("enabled_prompt") is True
        assert permissions.is_prompt_enabled("disabled_prompt") is False
        assert permissions.is_prompt_enabled("no_enabled_field") is False
        assert permissions.is_prompt_enabled("nonexistent") is False

    def test_get_all_methods(self):
        """Test getting all permissions of each type."""
        permissions = Permissions(
            tool_permissions={"tool1": {"enabled": True}, "tool2": {"enabled": False}},
            resource_permissions={"resource1": {"enabled": True}},
            prompt_permissions={"prompt1": {"enabled": False}},
        )

        all_tools = permissions.get_all_tools()
        all_resources = permissions.get_all_resources()
        all_prompts = permissions.get_all_prompts()

        assert len(all_tools) == 2
        assert len(all_resources) == 1
        assert len(all_prompts) == 1
        assert "tool1" in all_tools
        assert "tool2" in all_tools
        assert "resource1" in all_resources
        assert "prompt1" in all_prompts

    def test_get_enabled_methods(self):
        """Test getting only enabled permissions of each type."""
        permissions = Permissions(
            tool_permissions={
                "enabled_tool": {"enabled": True},
                "disabled_tool": {"enabled": False},
            },
            resource_permissions={
                "enabled_resource": {"enabled": True},
                "disabled_resource": {"enabled": False},
            },
            prompt_permissions={
                "enabled_prompt": {"enabled": True},
                "disabled_prompt": {"enabled": False},
            },
        )

        enabled_tools = permissions.get_enabled_tools()
        enabled_resources = permissions.get_enabled_resources()
        enabled_prompts = permissions.get_enabled_prompts()

        assert len(enabled_tools) == 1
        assert len(enabled_resources) == 1
        assert len(enabled_prompts) == 1
        assert "enabled_tool" in enabled_tools
        assert "enabled_resource" in enabled_resources
        assert "enabled_prompt" in enabled_prompts


class TestPermissionsError:
    """Test PermissionsError exception."""

    def test_permissions_error_basic(self):
        """Test basic PermissionsError functionality."""
        error = PermissionsError("Test error message")
        assert str(error) == "Test error message"
        assert error.message == "Test error message"
        assert error.permissions_path is None

    def test_permissions_error_with_path(self):
        """Test PermissionsError with permissions path."""
        path = Path("/test/path")
        error = PermissionsError("Test error message", path)
        assert str(error) == "Test error message"
        assert error.message == "Test error message"
        assert error.permissions_path == path


class TestPermissionsIntegration:
    """Integration tests for permissions system."""

    def test_full_permissions_workflow(self):
        """Test a complete permissions workflow."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create comprehensive permission files
            tool_perms = {
                "_metadata": {
                    "description": "Comprehensive tool permissions",
                    "last_updated": "2025-01-01",
                },
                "filesystem": {
                    "read_file": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                        "acl": "PRIVATE",
                    },
                    "write_file": {
                        "enabled": True,
                        "write_operation": True,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                        "acl": "PRIVATE",
                    },
                },
                "database": {
                    "query": {
                        "enabled": False,
                        "write_operation": True,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                        "acl": "SECRET",
                    }
                },
            }

            resource_perms = {
                "_metadata": {
                    "description": "Comprehensive resource permissions",
                    "last_updated": "2025-01-01",
                },
                "filesystem": {
                    "file:///home/user": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                    }
                },
            }

            prompt_perms = {
                "_metadata": {
                    "description": "Comprehensive prompt permissions",
                    "last_updated": "2025-01-01",
                },
                "system": {
                    "system_prompt": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": False,
                        "read_untrusted_public_data": False,
                    }
                },
            }

            # Write files
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps(resource_perms))
            (temp_path / "prompt_permissions.json").write_text(json.dumps(prompt_perms))

            # Load permissions
            permissions = Permissions.load(temp_path)

            # Test tool permissions
            assert permissions.is_tool_enabled("read_file") is True
            assert permissions.is_tool_enabled("write_file") is True
            assert permissions.is_tool_enabled("query") is False

            read_file_perm = permissions.get_tool_permission("read_file")
            assert read_file_perm is not None
            assert read_file_perm["read_private_data"] is True
            assert read_file_perm["write_operation"] is False
            assert read_file_perm["acl"] == "PRIVATE"

            # Test resource permissions
            assert permissions.is_resource_enabled("file:///home/user") is True

            # Test prompt permissions
            assert permissions.is_prompt_enabled("system_prompt") is True

            # Test enabled collections
            enabled_tools = permissions.get_enabled_tools()
            assert len(enabled_tools) == 2
            assert "read_file" in enabled_tools
            assert "write_file" in enabled_tools
            assert "query" not in enabled_tools

            # Test metadata
            assert permissions.tool_metadata is not None
            assert permissions.tool_metadata.description == "Comprehensive tool permissions"

            # Test reload
            # Update tool permissions
            tool_perms["filesystem"]["read_file"]["enabled"] = False
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))

            permissions.reload()

            assert permissions.is_tool_enabled("read_file") is False
            enabled_tools_after_reload = permissions.get_enabled_tools()
            assert len(enabled_tools_after_reload) == 1
            assert "write_file" in enabled_tools_after_reload


if __name__ == "__main__":
    pytest.main([__file__])
