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
        patch("src.server.SingleUserMCP") as mock_sumcp,
    ):
        # Arrange
        mock_config.reload = MagicMock()
        mock_perms.reload = MagicMock()
        new_instance = MagicMock()
        new_instance.initialize = AsyncMock()
        mock_sumcp.return_value = new_instance

        # Act
        await proxy.reinitialize_mcp_servers()

        # Assert
        mock_config.reload.assert_called_once()
        mock_perms.reload.assert_called_once()
        mock_sumcp.assert_called_once()
        new_instance.initialize.assert_awaited_once()
        assert proxy.single_user_mcp is new_instance
        assert proxy.single_user_mcp is not old_instance


@pytest.mark.asyncio
async def test_reinitialize_raises_http_exception_on_initialize_failure():
    proxy = OpenEdisonProxy(host="localhost", port=3000)

    with (
        patch("src.server.config") as mock_config,
        patch("src.server.all_permissions") as mock_perms,
        patch("src.server.SingleUserMCP") as mock_sumcp,
    ):
        # Arrange
        mock_config.reload = MagicMock()
        mock_perms.reload = MagicMock()
        new_instance = MagicMock()
        new_instance.initialize = AsyncMock(side_effect=Exception("boom"))
        mock_sumcp.return_value = new_instance

        # Act / Assert
        with pytest.raises(HTTPException) as exc_info:
            await proxy.reinitialize_mcp_servers()

        assert exc_info.value.status_code == 500
        assert "Failed to reinitialize MCP servers: boom" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_mount_and_unmount_via_public_api_changes_mcp_tool_listing():
    from fastmcp import FastMCP
    from src.single_user_mcp import SingleUserMCP

    child = FastMCP(name="child")

    @child.tool()  # type: ignore[misc]
    def hello() -> str:  # noqa: ANN201
        return "world"

    _ = hello

    # Ensure initial list does not contain prefixed tool
    mcp = SingleUserMCP()
    tools_before = await mcp.get_tools()
    before_names = set(tools_before.keys())
    assert "alpha_hello" not in before_names

    # Mount using public FastMCP mount API, then record in mounted_servers so unmount works
    mcp.mount(child, prefix="alpha")
    mcp.mounted_servers["alpha"] = {"config": object(), "proxy": child}  # type: ignore[assignment]

    tools_after = await mcp.get_tools()
    after_names = set(tools_after.keys())
    assert "alpha_hello" in after_names

    # Unmount via our API and verify removal from MCP list
    assert await mcp.unmount("alpha") is True
    tools_final = await mcp.get_tools()
    final_names = set(tools_final.keys())
    assert "alpha_hello" not in final_names


@pytest.mark.asyncio
async def test_e2e_mount_then_unmount_updates_tools_list():
    # Arrange a real child FastMCP with a simple tool; no mocking of fastmcp internals
    from fastmcp import FastMCP

    child = FastMCP(name="child")

    @child.tool()  # type: ignore[misc]
    def ping() -> str:  # noqa: ANN201
        return "pong"

    # Touch the function to satisfy strict linters
    _ = ping

    from src.single_user_mcp import SingleUserMCP

    mcp = SingleUserMCP()

    # Initially, child tool should not be listed
    before_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" not in before_keys

    # Mount using the public FastMCP API with a prefix
    mcp.mount(child, prefix="alpha")
    mcp.mounted_servers["alpha"] = {"config": object(), "proxy": child}  # type: ignore[assignment]

    after_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" in after_keys

    # Unmount via our implemented API and verify removal
    ok2 = await mcp.unmount("alpha")
    assert ok2 is True

    final_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" not in final_keys
