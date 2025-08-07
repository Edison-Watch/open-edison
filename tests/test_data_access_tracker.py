"""
Tests for Data Access Tracker

Tests the lethal trifecta monitoring functionality.
"""

import pytest

from src.middleware.data_access_tracker import DataAccessTracker, SecurityError


def test_data_access_tracker_initialization():
    """Test that the tracker initializes with safe defaults."""
    tracker = DataAccessTracker()

    assert not tracker.has_private_data_access
    assert not tracker.has_untrusted_content_exposure
    assert not tracker.has_external_communication
    assert not tracker.is_trifecta_achieved()


def test_private_data_access_detection():
    """Test detection of private data access through tool names."""
    tracker = DataAccessTracker()

    # Test real filesystem tools
    tracker.add_tool_call("filesystem_read_file")
    assert tracker.has_private_data_access

    # Test another real filesystem tool
    tracker2 = DataAccessTracker()
    tracker2.add_tool_call("filesystem_list_directory")
    assert tracker2.has_private_data_access


def test_untrusted_content_exposure_detection():
    """Test detection of untrusted content exposure."""
    # Note: Current Open Edison tools don't include web/external content tools
    # So we'll test that unknown tools raise ValueError
    tracker = DataAccessTracker()

    # Test an unknown tool (should raise ValueError)
    import pytest

    with pytest.raises(ValueError, match="No security configuration found"):
        tracker.add_tool_call("hypothetical_web_tool")


def test_external_communication_detection():
    """Test detection of external communication capabilities."""
    tracker = DataAccessTracker()

    # Test real write operations - filesystem write
    tracker.add_tool_call("filesystem_write_file")
    assert tracker.has_external_communication

    # Test database write operations
    tracker2 = DataAccessTracker()
    tracker2.add_tool_call("sqlite_create_record")
    assert tracker2.has_external_communication


def test_lethal_trifecta_achievement():
    """Test that the lethal trifecta is detected correctly."""
    tracker = DataAccessTracker()

    # Add each component of the trifecta using real tools
    tracker.add_tool_call("filesystem_read_file")  # Private data
    assert not tracker.is_trifecta_achieved()  # Only 1/3

    tracker.add_tool_call("sqlite_create_record")  # External communication (write)
    assert not tracker.is_trifecta_achieved()  # Only 2/3 (missing untrusted content)

    # Since current Open Edison doesn't have web tools, we can't achieve trifecta with real tools
    # But we can test by manually setting the untrusted content flag
    tracker.has_untrusted_content_exposure = True
    assert tracker.is_trifecta_achieved()  # All 3 achieved!


def test_safe_tools_remain_safe():
    """Test that built-in safe tools don't trigger security flags."""
    tracker = DataAccessTracker()

    # Built-in safe tools
    tracker.add_tool_call("echo")
    tracker.add_tool_call("get_server_info")
    tracker.add_tool_call("get_security_status")

    assert not tracker.has_private_data_access
    assert not tracker.has_untrusted_content_exposure
    assert not tracker.has_external_communication
    assert not tracker.is_trifecta_achieved()


def test_namespace_based_classification():
    """Test that server namespaces influence classification."""
    # With strict JSON-only configuration, we need explicit tool definitions
    # Test that unknown tools properly raise ValueError
    tracker = DataAccessTracker()

    # Test unknown namespaced tool - should raise ValueError
    with pytest.raises(ValueError, match="No security configuration found"):
        tracker.add_tool_call("unknown_server/some_tool")

    # Test that real tools work correctly
    tracker2 = DataAccessTracker()
    tracker2.add_tool_call("filesystem_read_file")
    assert tracker2.has_private_data_access


def test_tracker_serialization():
    """Test that tracker can be serialized to dict."""
    tracker = DataAccessTracker()

    # Add some real tool calls
    tracker.add_tool_call("filesystem_read_file")  # Private data access
    tracker.add_tool_call("sqlite_list_tables")  # Private data access (read only)

    # Serialize
    data = tracker.to_dict()

    assert "lethal_trifecta" in data
    trifecta = data["lethal_trifecta"]
    assert trifecta["has_private_data_access"] is True
    assert trifecta["has_untrusted_content_exposure"] is False  # No web tools in current setup
    assert trifecta["has_external_communication"] is False  # No write operations
    assert trifecta["trifecta_achieved"] is False


def test_tracker_caching():
    """Test that tracker correctly handles repeated tool calls."""
    # We can't directly test the module-level cache due to it being private,
    # but we can test that repeated calls work correctly
    tracker = DataAccessTracker()

    # First call should work
    tracker.add_tool_call("filesystem_read_file")
    assert tracker.has_private_data_access

    # Second call with same tool should work (using cache internally)
    tracker.add_tool_call("filesystem_read_file")
    # Should still only have one type of access
    assert tracker.has_private_data_access
    assert not tracker.has_external_communication
    assert not tracker.has_untrusted_content_exposure

    # Different tool should also work
    tracker.add_tool_call("sqlite_list_tables")
    # Should maintain the same flags (both are private data tools)
    assert tracker.has_private_data_access
    assert not tracker.has_external_communication
    assert not tracker.has_untrusted_content_exposure


def test_trifecta_blocking():
    """Test that tool calls are blocked when trifecta is achieved."""
    tracker = DataAccessTracker()

    # Manually set trifecta flags (simulate achieving trifecta)
    tracker.has_private_data_access = True
    tracker.has_untrusted_content_exposure = True
    tracker.has_external_communication = True

    # Verify trifecta is achieved
    assert tracker.is_trifecta_achieved()

    # Now any tool call should be blocked
    with pytest.raises(SecurityError, match="lethal trifecta achieved"):
        tracker.add_tool_call("filesystem_read_file")


def test_trifecta_achieves_then_blocks():
    """Test that trifecta achievement enables blocking on subsequent calls."""
    # For this test, we need to add a tool with untrusted content to the JSON config
    # Since current Open Edison doesn't have web tools, we'll test the logic
    tracker = DataAccessTracker()

    # Set up trifecta components manually for testing (missing JSON config for web tools)
    tracker.has_private_data_access = True
    tracker.has_untrusted_content_exposure = True

    # Add external communication to achieve trifecta
    tracker.add_tool_call("sqlite_create_record")  # Write operation
    assert tracker.is_trifecta_achieved()

    # Next call should be blocked
    with pytest.raises(SecurityError, match="lethal trifecta achieved"):
        tracker.add_tool_call("filesystem_read_file")


if __name__ == "__main__":
    pytest.main([__file__])
