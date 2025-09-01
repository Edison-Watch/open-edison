"""MCP importer package for Open Edison scripts.

Import submodules explicitly as needed, e.g. `from src.mcp_importer import cli`.
"""

# pyright: reportUnsupportedDunderAll=false

__all__ = [
    "paths",
    "parsers",
    "importers",
    "merge",
    "cli",
    "api",
]
