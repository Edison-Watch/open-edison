"""
Tests for OpenEdisonProxy.reinitialize_mcp_servers matching current implementation.

The endpoint should:
- Reload config and permissions
- Replace the SingleUserMCP instance
- Initialize the new instance
- On error, raise HTTPException(500, ...)
"""

# pyright: reportMissingTypeStubs=false

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.server import OpenEdisonProxy


@pytest.mark.asyncio
async def test_reinitialize_success_replaces_instance_and_initializes():
    proxy = OpenEdisonProxy(host="localhost", port=3000)
    old_instance = proxy.single_user_mcp

    with (
        patch("src.server.config") as mock_config,
        patch("src.server.all_permissions") as mock_perms,
        patch("src.server.SingleUserMCP") as MockSUMCP,
    ):
        # Arrange
        mock_config.load = MagicMock()
        mock_perms.reload = MagicMock()
        new_instance = MagicMock()
        new_instance.initialize = AsyncMock()
        MockSUMCP.return_value = new_instance

        # Act
        await proxy.reinitialize_mcp_servers()

        # Assert
        mock_config.load.assert_called_once()
        mock_perms.reload.assert_called_once()
        MockSUMCP.assert_called_once()
        new_instance.initialize.assert_awaited_once()
        assert proxy.single_user_mcp is new_instance
        assert proxy.single_user_mcp is not old_instance


@pytest.mark.asyncio
async def test_reinitialize_raises_http_exception_on_initialize_failure():
    proxy = OpenEdisonProxy(host="localhost", port=3000)

    with (
        patch("src.server.config") as mock_config,
        patch("src.server.all_permissions") as mock_perms,
        patch("src.server.SingleUserMCP") as MockSUMCP,
    ):
        # Arrange
        mock_config.load = MagicMock()
        mock_perms.reload = MagicMock()
        new_instance = MagicMock()
        new_instance.initialize = AsyncMock(side_effect=Exception("boom"))
        MockSUMCP.return_value = new_instance

        # Act / Assert
        with pytest.raises(HTTPException) as exc_info:
            await proxy.reinitialize_mcp_servers()

        assert exc_info.value.status_code == 500
        assert "Failed to reinitialize MCP servers: boom" in str(exc_info.value.detail)
