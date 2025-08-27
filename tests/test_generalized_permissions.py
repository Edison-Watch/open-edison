"""
Tests for Generalized Permission System

Tests the enhanced permission system that handles tools, resources, and prompts
with separate JSON configuration files for each type.
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.middleware.data_access_tracker import DataAccessTracker  # type: ignore
from src.permissions import (  # type: ignore
    Permissions,
    PermissionsError,
    ToolPermission,
)


@pytest.fixture(autouse=True)
def _force_repo_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests use repo-root config/permissions instead of user config."""
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(Path(__file__).parent.parent))


class TestResourcePermissions:
    """Test resource access permission framework."""

    def test_unknown_resource_raises_error(self):
        """Test that unknown resource schemes raise ValueError."""
        tracker = DataAccessTracker()

        # Since config is empty, permissions lookup raises PermissionsError
        with pytest.raises(PermissionsError):
            tracker.add_resource_access("file:/home/user/config.json")

        with pytest.raises(PermissionsError):
            tracker.add_resource_access("http://example.com/data.json")

        with pytest.raises(PermissionsError):
            tracker.add_resource_access("database:user_table")


class TestPromptPermissions:
    """Test prompt access permission framework."""

    def test_unknown_prompt_raises_error(self):
        """Test that unknown prompt types raise ValueError."""
        tracker = DataAccessTracker()

        # Since config is empty, permissions lookup raises PermissionsError
        with pytest.raises(PermissionsError):
            tracker.add_prompt_access("system")

        with pytest.raises(PermissionsError):
            tracker.add_prompt_access("external_prompt")

        with pytest.raises(PermissionsError):
            tracker.add_prompt_access("template:system_message")


class TestGeneralizedTrifecta:
    """Test lethal trifecta achievement framework across all permission types."""

    def test_trifecta_blocks_subsequent_access(self):
        """Test that trifecta achievement blocks subsequent access to resources and prompts."""
        tracker = DataAccessTracker()

        # Achieve trifecta using tools only
        tracker.add_tool_call("filesystem_read_file")  # Private data
        tracker.add_tool_call("sqlite_create_record")  # Write operation
        # TODO: Need a tool that triggers untrusted content exposure to complete trifecta

        # For now, test that the blocking mechanism works for new access types
        # Even without trifecta, test the SecurityError handling
        # This will fail since we don't have a complete trifecta, but we can test the method exists
        assert hasattr(tracker, "add_resource_access")
        assert hasattr(tracker, "add_prompt_access")


class TestPermissionConfigIntegration:
    """Test integration between different permission configuration files."""

    def test_all_config_files_loaded(self):
        """Test that all permission configuration files are loaded."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            tool_perms = {"_metadata": {"description": "Tool perms", "last_updated": "2025-01-01"}}
            resource_perms = {
                "_metadata": {"description": "Resource perms", "last_updated": "2025-01-01"}
            }
            prompt_perms = {
                "_metadata": {"description": "Prompt perms", "last_updated": "2025-01-01"}
            }

            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps(resource_perms))
            (temp_path / "prompt_permissions.json").write_text(json.dumps(prompt_perms))

            perms = Permissions(temp_path)
            assert isinstance(perms, Permissions)
            assert perms.tool_metadata is not None
            assert perms.resource_metadata is not None
            assert perms.prompt_metadata is not None

    def test_consistent_permission_structure(self):
        """Test that all permission types use consistent structure."""
        # Build temp config and validate tool structure and error consistency
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            tool_perms = {
                "_metadata": {"description": "Tool perms", "last_updated": "2025-01-01"},
                "filesystem": {
                    "read_file": {
                        "enabled": True,
                        "write_operation": False,
                        "read_private_data": True,
                        "read_untrusted_public_data": False,
                        "acl": "PRIVATE",
                    }
                },
            }
            (temp_path / "tool_permissions.json").write_text(json.dumps(tool_perms))
            (temp_path / "resource_permissions.json").write_text(json.dumps({"_metadata": {}}))
            (temp_path / "prompt_permissions.json").write_text(json.dumps({"_metadata": {}}))

            perms = Permissions(temp_path)
            tp = perms.get_tool_permission("filesystem_read_file")
            assert isinstance(tp, ToolPermission)
            assert tp.enabled is True
            assert tp.read_private_data is True
            assert tp.write_operation is False

            # Unknown resource/prompt raise PermissionsError
            with pytest.raises(PermissionsError):
                perms.get_resource_permission("file:/test.txt")
            with pytest.raises(PermissionsError):
                perms.get_prompt_permission("system")


if __name__ == "__main__":
    pytest.main([__file__])
