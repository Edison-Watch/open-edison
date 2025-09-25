"""
Open Edison Source Package.

Note: Avoid importing heavy submodules at package import time to keep
packaging/import of light utilities (e.g., mcp_importer) side‑effect free.
"""

from .langgraph_integration import Edison as Edison  # noqa: F401  # re-export for convenience

__all__ = ["Edison"]
