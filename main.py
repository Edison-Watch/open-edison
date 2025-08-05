"""
Open Edison - Single-User MCP Proxy Server
Main entry point for running the Open Edison MCP proxy server.
"""

import asyncio
import sys
import traceback

from loguru import logger as log

from src.config import config
from src.server import OpenEdisonProxy


async def main():
    """
    Main entry point for Open Edison
    """
    log.info("🔍 Starting Open Edison - Single-User MCP Proxy")

    # Create the proxy server
    proxy = OpenEdisonProxy(host=config.server.host, port=config.server.port)

    # Start the server
    try:
        await proxy.start()
        log.info("🚀 Open Edison is ready to proxy MCP traffic")
        # Keep the server running
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        log.info("👋 Received shutdown signal")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("👋 Open Edison shutting down...")
    except Exception as e:
        log.error(f"❌ Fatal error: {e}, traceback: {traceback.format_exc()}")
        sys.exit(1)
