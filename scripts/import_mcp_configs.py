#!/usr/bin/env python3
"""Thin wrapper to run the MCP importer package CLI."""

from __future__ import annotations

import sys
from pathlib import Path


def _run() -> int:
    # Ensure package imports
    this_file = Path(__file__).resolve()
    repo_root = this_file.parents[1]
    pkg_dir = repo_root / "scripts" / "mcp_importer"
    if str(pkg_dir) not in sys.path:
        sys.path.insert(0, str(pkg_dir))

    from mcp_importer.cli import main  # type: ignore

    return main()


if __name__ == "__main__":
    raise SystemExit(_run())
