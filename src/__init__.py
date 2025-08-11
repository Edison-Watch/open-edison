"""
Open Edison Source Package

Main source code package for the Open Edison single-user MCP proxy server.

This package exposes a CLI via `open-edison` / `open_edison` entrypoints.
"""

from .server import OpenEdisonProxy

__all__ = ["OpenEdisonProxy"]
