#!/usr/bin/env python3
"""
Simple connection test for Open Edison MCP server
"""

import asyncio

from fastmcp import Client as FastMCPClient
from loguru import logger as log


async def test_connection():
    """Test basic connection to Open Edison"""
    url = "http://localhost:3000/mcp/"
    client = FastMCPClient(url)

    try:
        log.info(f"Testing connection to Open Edison on {url}...")

        async with client:
            log.info("✅ Connection successful!")

            # Test if we can call builtin_get_available_tools
            log.info("Testing builtin_get_available_tools...")
            result = await client.call_tool("builtin_get_available_tools", {})

            if result:
                log.info("✅ builtin_get_available_tools call successful!")
                assert hasattr(result, "content")
                content = result.content
                log.debug(f"Content (non-string): {content}")
            else:
                raise ValueError("builtin_get_available_tools call failed")

    except Exception as e:
        log.error(f"❌ Connection failed: {e}")
        exit(1)

    log.info("✅ Disconnected")


if __name__ == "__main__":
    asyncio.run(test_connection())
