"""MCP importer package for Open Edison scripts.

Submodules:
- paths: OS and application-specific path discovery utilities
- parsers: best-effort parsers to normalize foreign MCP configs
- importers: high-level import functions per source tool
- merge: merging strategies for adding servers into config.json
- cli: command-line entrypoint
"""

__all__ = [
    "paths",
    "parsers",
    "importers",
    "merge",
    "cli",
]
