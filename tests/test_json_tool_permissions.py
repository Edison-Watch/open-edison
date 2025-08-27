"""
Tests for JSON-based Tool Permissions

Tests the external JSON configuration system for tool security classifications.
This test file focuses on tool permissions while the generalized permissions
are tested in test_generalized_permissions.py.
"""

from pathlib import Path

import pytest

from src.middleware.data_access_tracker import DataAccessTracker
from src.permissions import PermissionsError


@pytest.fixture(autouse=True)  # noqa
def _force_repo_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests use repo-root config/permissions instead of user config."""
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(Path(__file__).parent.parent))


def test_json_config_loading():
    """Test that the tracker can load permissions from JSON config."""
    tracker = DataAccessTracker()

    # Test that built-in tools are still safe
    tracker.add_tool_call("builtin_echo")
    assert not tracker.has_private_data_access
    assert not tracker.has_untrusted_content_exposure
    assert not tracker.has_external_communication


def test_json_exact_match():
    """Test exact tool name matching from JSON config."""
    tracker = DataAccessTracker()

    # Test real tools from our JSON config
    tracker.add_tool_call("filesystem_read_file")
    assert tracker.has_private_data_access
    assert not tracker.has_untrusted_content_exposure
    assert not tracker.has_external_communication

    tracker2 = DataAccessTracker()
    tracker2.add_tool_call("sqlite_create_record")
    assert tracker2.has_private_data_access  # Database access
    assert not tracker2.has_untrusted_content_exposure
    assert tracker2.has_external_communication  # Write operation

    tracker3 = DataAccessTracker()
    tracker3.add_tool_call("builtin_echo")  # Built-in safe tool
    assert not tracker3.has_private_data_access
    assert not tracker3.has_untrusted_content_exposure
    assert not tracker3.has_external_communication


def test_write_file_permission():
    """Test that specific tool definitions take precedence over wildcard patterns."""
    # Since we enforce strict JSON configuration, tools must be explicitly defined
    tracker = DataAccessTracker()

    # Test specific filesystem tool
    tracker.add_tool_call("filesystem_write_file")
    assert not tracker.has_private_data_access
    assert tracker.has_external_communication  # Write operation
    assert not tracker.has_untrusted_content_exposure


def test_unknown_tool_raises_error():
    """Test that unknown tools raise ValueError instead of defaulting to safe."""
    tracker = DataAccessTracker()

    # Unknown tool should raise ValueError
    with pytest.raises(PermissionsError, match="not found in permissions"):
        tracker.add_tool_call("unknown_dangerous_tool")


def test_json_caching():
    """Test that JSON configuration is cached properly."""
    tracker = DataAccessTracker()

    # First call should load and cache JSON (caching happens at module level now)
    tracker.add_tool_call("filesystem_read_file")

    # Second call should use cache
    tracker2 = DataAccessTracker()
    tracker2.add_tool_call("sqlite_list_tables")

    # Both calls should succeed (indicating cache is working)
    assert tracker.has_private_data_access
    assert tracker2.has_private_data_access


if __name__ == "__main__":
    pytest.main([__file__])
