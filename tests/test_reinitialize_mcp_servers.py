"""
Tests for the reinitialize_mcp_servers function.

Tests all conditional paths inside the loop that handles different server states.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.config import MCPServerConfig
from src.server import OpenEdisonProxy


class TestReinitializeMCPServers:
    """Test the reinitialize_mcp_servers function with all conditional paths."""

    @pytest.fixture
    def mock_proxy(self):
        """Create a mock OpenEdisonProxy instance."""
        proxy = OpenEdisonProxy(host="localhost", port=3000)
        proxy.single_user_mcp = AsyncMock()
        return proxy

    @pytest.fixture
    def mock_config_servers(self):
        """Create test MCP server configurations."""
        return [
            MCPServerConfig(
                name="server-enabled-mounted", command="echo", args=["test"], enabled=True
            ),
            MCPServerConfig(
                name="server-enabled-not-mounted", command="echo", args=["test"], enabled=True
            ),
            MCPServerConfig(
                name="server-disabled-mounted", command="echo", args=["test"], enabled=False
            ),
            MCPServerConfig(
                name="server-disabled-not-mounted", command="echo", args=["test"], enabled=False
            ),
        ]

    @pytest.fixture
    def mock_mounted_servers(self):
        """Create mock mounted servers response."""
        return [{"name": "server-enabled-mounted"}, {"name": "server-disabled-mounted"}]

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_reinitialize_mcp_servers_success(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test successful reinitialization with all server states."""
        # Setup mocks
        mock_config.mcp_servers = mock_config_servers
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = True
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock(return_value=True)

        # Execute
        result = await mock_proxy.reinitialize_mcp_servers()

        # Verify basic flow
        mock_clear_caches.assert_called_once()
        mock_config.reload.assert_called_once()
        mock_permissions.reload.assert_called_once()
        mock_proxy.single_user_mcp.get_mounted_servers.assert_called_once()
        mock_permissions.debug_print_all_server_disabled_report.assert_called()

        # Verify result structure
        assert result["status"] == "success"
        assert result["message"] == "MCP servers reinitialized successfully"
        assert result["mounted_servers"] == ["server-enabled-mounted", "server-disabled-mounted"]
        assert result["total_mounted"] == 2

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_server_enabled_mounted_with_disabled_permissions(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test server that is enabled and mounted with disabled permissions."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[0]]  # server-enabled-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = True
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute
        await mock_proxy.reinitialize_mcp_servers()

        # Verify server-enabled-mounted path
        mock_permissions.set_server_disabled.assert_called_with("server-enabled-mounted", False)
        mock_proxy.single_user_mcp.create_composite_proxy.assert_not_called()

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_server_enabled_mounted_without_disabled_permissions(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test server that is enabled and mounted without disabled permissions."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[0]]  # server-enabled-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute
        await mock_proxy.reinitialize_mcp_servers()

        # Verify server-enabled-mounted path without disabled permissions
        mock_permissions.set_server_disabled.assert_not_called()
        mock_proxy.single_user_mcp.create_composite_proxy.assert_not_called()

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_server_enabled_not_mounted(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test server that is enabled but not mounted."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[1]]  # server-enabled-not-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock(return_value=True)

        # Execute
        await mock_proxy.reinitialize_mcp_servers()

        # Verify server-enabled-not-mounted path
        mock_proxy.single_user_mcp.create_composite_proxy.assert_called_once_with(
            [mock_config_servers[1]]
        )
        mock_permissions.set_server_disabled.assert_not_called()

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_server_disabled_mounted(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test server that is disabled but mounted."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[2]]  # server-disabled-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute
        await mock_proxy.reinitialize_mcp_servers()

        # Verify server-disabled-mounted path
        mock_permissions.set_server_disabled.assert_called_once_with(
            "server-disabled-mounted", True
        )
        mock_proxy.single_user_mcp.create_composite_proxy.assert_not_called()

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_server_disabled_not_mounted(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test server that is disabled and not mounted."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[3]]  # server-disabled-not-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute
        await mock_proxy.reinitialize_mcp_servers()

        # Verify server-disabled-not-mounted path
        mock_permissions.set_server_disabled.assert_not_called()
        mock_proxy.single_user_mcp.create_composite_proxy.assert_not_called()

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_all_server_states_combined(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test all server states in a single reinitialization."""
        # Setup mocks
        mock_config.mcp_servers = mock_config_servers  # All four server states
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = True
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock(return_value=True)

        # Execute
        result = await mock_proxy.reinitialize_mcp_servers()

        # Verify all paths were executed
        # server-enabled-mounted: should call set_server_disabled(False)
        # server-enabled-not-mounted: should call create_composite_proxy
        # server-disabled-mounted: should call set_server_disabled(True)
        # server-disabled-not-mounted: should do nothing

        expected_set_server_disabled_calls = [
            (("server-enabled-mounted", False),),  # enabled and mounted with disabled permissions
            (("server-disabled-mounted", True),),  # disabled but mounted
        ]
        assert (
            mock_permissions.set_server_disabled.call_args_list
            == expected_set_server_disabled_calls
        )

        # Should only call create_composite_proxy for server-enabled-not-mounted
        mock_proxy.single_user_mcp.create_composite_proxy.assert_called_once_with(
            [mock_config_servers[1]]
        )

        # Verify result
        assert result["status"] == "success"
        assert result["total_mounted"] == 2

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_reinitialize_mcp_servers_exception(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test reinitialization when an exception occurs."""
        # Setup mocks
        mock_config.mcp_servers = mock_config_servers
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        # Make get_mounted_servers raise an exception
        mock_proxy.single_user_mcp.get_mounted_servers.side_effect = Exception("Test error")
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute and verify exception handling
        with pytest.raises(HTTPException) as exc_info:
            await mock_proxy.reinitialize_mcp_servers()

        assert exc_info.value.status_code == 500
        assert "Failed to reinitialize MCP servers: Test error" in str(exc_info.value.detail)

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_create_composite_proxy_failure(
        self,
        mock_clear_caches,
        mock_permissions,
        mock_config,
        mock_proxy,
        mock_config_servers,
        mock_mounted_servers,
    ):
        """Test when create_composite_proxy fails."""
        # Setup mocks
        mock_config.mcp_servers = [mock_config_servers[1]]  # server-enabled-not-mounted
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock(
            side_effect=Exception("Mount failed")
        )

        # Execute and verify exception handling
        with pytest.raises(HTTPException) as exc_info:
            await mock_proxy.reinitialize_mcp_servers()

        assert exc_info.value.status_code == 500
        assert "Failed to reinitialize MCP servers: Mount failed" in str(exc_info.value.detail)

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_empty_mcp_servers_list(
        self, mock_clear_caches, mock_permissions, mock_config, mock_proxy, mock_mounted_servers
    ):
        """Test reinitialization with empty MCP servers list."""
        # Setup mocks
        mock_config.mcp_servers = []  # Empty list
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = mock_mounted_servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock()

        # Execute
        result = await mock_proxy.reinitialize_mcp_servers()

        # Verify no server-specific operations were performed
        mock_permissions.set_server_disabled.assert_not_called()
        mock_proxy.single_user_mcp.create_composite_proxy.assert_not_called()

        # Verify basic flow still works
        assert result["status"] == "success"
        assert result["total_mounted"] == 2

    @patch("src.server.config")
    @patch("src.server.permissions")
    @patch("src.server.clear_all_classify_permissions_caches")
    async def test_no_mounted_servers(
        self, mock_clear_caches, mock_permissions, mock_config, mock_proxy, mock_config_servers
    ):
        """Test reinitialization when no servers are mounted."""
        # Setup mocks
        mock_config.mcp_servers = mock_config_servers
        mock_config.reload = MagicMock()
        mock_permissions.reload = MagicMock()
        mock_permissions.has_server_disabled_permissions.return_value = False
        mock_permissions.set_server_disabled = MagicMock()
        mock_permissions.debug_print_all_server_disabled_report = MagicMock()

        mock_proxy.single_user_mcp.get_mounted_servers.return_value = []  # No mounted servers
        mock_proxy.single_user_mcp.create_composite_proxy = AsyncMock(return_value=True)

        # Execute
        result = await mock_proxy.reinitialize_mcp_servers()

        # Verify enabled servers get mounted
        # Check that create_composite_proxy was called twice (once for each enabled server)
        assert mock_proxy.single_user_mcp.create_composite_proxy.call_count == 2

        # Verify the specific calls were made with the correct arguments
        calls = mock_proxy.single_user_mcp.create_composite_proxy.call_args_list
        assert len(calls) == 2

        # Verify the arguments passed to each call
        # The call structure is: call([server_config])
        assert calls[0][0][0][0] == mock_config_servers[0]  # First call with first server
        assert calls[1][0][0][0] == mock_config_servers[1]  # Second call with second server

        # Verify disabled servers don't get mounted
        mock_permissions.set_server_disabled.assert_not_called()

        # Verify result
        assert result["status"] == "success"
        assert result["total_mounted"] == 0
