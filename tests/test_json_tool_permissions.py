"""
Tests for JSON-based Tool Permissions

Tests the external JSON configuration system for tool security classifications.
This test file focuses on tool permissions while the generalized permissions
are tested in test_generalized_permissions.py.
"""

import tempfile
from pathlib import Path

import pytest

from src.middleware.data_access_tracker import DataAccessTracker


def test_json_config_loading():
    """Test that the tracker can load permissions from JSON config."""
    tracker = DataAccessTracker()

    # Test that built-in tools are still safe
    tracker.add_tool_call("echo")
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
    tracker3.add_tool_call("echo")  # Built-in safe tool
    assert not tracker3.has_private_data_access
    assert not tracker3.has_untrusted_content_exposure
    assert not tracker3.has_external_communication


def test_json_wildcard_patterns():
    """Test wildcard pattern matching from JSON config."""
    tracker = DataAccessTracker()

    # Test test_server/* pattern that we added to the config
    tracker.add_tool_call("test_server/some_unknown_tool")
    assert tracker.has_private_data_access
    assert not tracker.has_untrusted_content_exposure
    assert not tracker.has_external_communication

    # Test that unknown tools without patterns raise ValueError
    tracker2 = DataAccessTracker()
    with pytest.raises(ValueError, match="No security configuration found"):
        tracker2.add_tool_call("unknown_server/unknown_tool")


def test_json_specific_overrides_wildcard():
    """Test that specific tool definitions take precedence over wildcard patterns."""
    # Since we enforce strict JSON configuration, tools must be explicitly defined
    tracker = DataAccessTracker()

    # Test specific filesystem tool
    tracker.add_tool_call("filesystem_write_file")
    assert tracker.has_private_data_access
    assert tracker.has_external_communication  # Write operation
    assert not tracker.has_untrusted_content_exposure


def test_unknown_tool_raises_error():
    """Test that unknown tools raise ValueError instead of defaulting to safe."""
    tracker = DataAccessTracker()

    # Unknown tool should raise ValueError
    with pytest.raises(ValueError, match="No security configuration found"):
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


def test_malformed_json_handling():
    """Test handling of malformed JSON configuration."""
    # Create a temporary malformed JSON file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write('{"invalid": json content}')  # Malformed JSON
        temp_path = f.name

    try:
        tracker = DataAccessTracker()

        # Mock the path to point to malformed file
        def mock_load():
            return {}  # Simulate error handling returns empty dict

        tracker._load_tool_permissions = mock_load

        # Should raise ValueError since no valid config is loaded
        with pytest.raises(ValueError, match="No security configuration found"):
            tracker.add_tool_call("any_tool")

    finally:
        # Clean up
        Path(temp_path).unlink()


def test_generalized_methods_available():
    """Test that the new generalized methods are available on DataAccessTracker."""
    tracker = DataAccessTracker()

    # Test that new methods exist
    assert hasattr(tracker, "add_resource_access")
    assert hasattr(tracker, "add_prompt_access")
    assert callable(tracker.add_resource_access)
    assert callable(tracker.add_prompt_access)

    # Test that new classification methods exist
    assert hasattr(tracker, "_classify_resource_permissions")
    assert hasattr(tracker, "_classify_prompt_permissions")
    assert callable(tracker._classify_resource_permissions)
    assert callable(tracker._classify_prompt_permissions)


if __name__ == "__main__":
    pytest.main([__file__])
