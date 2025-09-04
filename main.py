"""
Open Edison - Single-User MCP Proxy Server
Main entry point for running the Open Edison MCP proxy server.
"""

import asyncio
import sys

from loguru import logger as log

from src.config import Config
from src.server import OpenEdisonProxy


async def main():
    """
    Main entry point for Open Edison
    """
    log.info("🔍 Starting Open Edison - Single-User MCP Proxy")
    log.debug("Repository access verified - ready for MCP proxying development")

    # Create the proxy server
    proxy = OpenEdisonProxy(host=Config().server.host, port=Config().server.port)

    # Start the server
    try:
        await proxy.start()
    finally:
        log.info("👋 Open Edison shutting down...")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("👋 Open Edison shutting down...")
    except Exception as e:
        log.exception(f"❌ Fatal error: {e}")
        sys.exit(1)
