#!/usr/bin/env python3
"""
Super simple test script:
1. Launch Open Edison server
2. Wait 10 seconds
3. Connect and run builtin_echo
"""

import asyncio

from fastmcp import Client as FastMCPClient
from loguru import logger as log

FASTMCP_URL = "http://localhost:3000/mcp/"


async def main() -> None:
    n = 3
    log.info("⏳ Waiting {} seconds...", n)
    await asyncio.sleep(n)

    log.info("🔌 Connecting to Open Edison at {}", FASTMCP_URL)
    async with FastMCPClient(FASTMCP_URL) as client:
        log.info("📞 Calling builtin_echo tool...")
        result = await client.call_tool("builtin_echo", {"text": "Hello from test!"})
        log.info("✅ Result: {}", result)


if __name__ == "__main__":
    asyncio.run(main())
