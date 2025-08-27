"""
Tests for OpenEdisonProxy.reinitialize_mcp_servers matching current implementation.

The endpoint should:
- Reload config and permissions
- Replace the SingleUserMCP instance
- Initialize the new instance
- On error, raise HTTPException(500, ...)
"""

# pyright: reportMissingTypeStubs=false

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastmcp import FastMCP

from src.server import OpenEdisonProxy
from src.single_user_mcp import SingleUserMCP
from src.single_user_mcp import mounted_servers as mcp_mounted_servers


@pytest.mark.asyncio
async def test_reinitialize_calls_initialize_in_place_without_replacement():
    proxy = OpenEdisonProxy(host="localhost", port=3000)
    old_instance = proxy.single_user_mcp

    # Arrange: reinitialize should call initialize() on the existing instance
    old_instance.initialize = AsyncMock()

    # Act
    await proxy.reinitialize_mcp_servers()

    # Assert
    old_instance.initialize.assert_awaited_once()
    assert proxy.single_user_mcp is old_instance


@pytest.mark.asyncio
async def test_reinitialize_raises_http_exception_on_initialize_failure():
    proxy = OpenEdisonProxy(host="localhost", port=3000)

    # Arrange: make initialize() on existing instance fail
    proxy.single_user_mcp.initialize = AsyncMock(side_effect=Exception("boom"))

    # Act / Assert
    with pytest.raises(HTTPException) as exc_info:
        await proxy.reinitialize_mcp_servers()

    assert exc_info.value.status_code == 500
    assert "Failed to reinitialize MCP servers: boom" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_mount_and_unmount_via_public_api_changes_mcp_tool_listing():
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
    mcp_mounted_servers["alpha"] = {"config": object(), "proxy": child}  # type: ignore[assignment]

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

    mcp = SingleUserMCP()

    # Initially, child tool should not be listed
    before_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" not in before_keys

    # Mount using the public FastMCP API with a prefix
    mcp.mount(child, prefix="alpha")
    mcp_mounted_servers["alpha"] = {"config": object(), "proxy": child}  # type: ignore[assignment]

    after_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" in after_keys

    # Unmount via our implemented API and verify removal
    ok2 = await mcp.unmount("alpha")
    assert ok2 is True

    final_keys = {t.key for t in await mcp._tool_manager.list_tools()}  # type: ignore[attr-defined]
    assert "alpha_ping" not in final_keys
