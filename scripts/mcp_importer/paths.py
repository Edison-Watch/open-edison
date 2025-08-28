from __future__ import annotations

import os
import sys
from pathlib import Path


def is_windows() -> bool:
    return os.name == "nt"


def is_macos() -> bool:
    return sys.platform == "darwin"


def is_linux() -> bool:
    return not is_windows() and not is_macos()


def find_cursor_user_file() -> list[Path]:
    """Find user-level Cursor MCP config (~/.cursor/mcp.json)."""
    p = (Path.home() / ".cursor" / "mcp.json").resolve()
    return [p] if p.exists() else []


def find_vscode_user_mcp_file() -> list[Path]:
    """Find VSCode user-level MCP config (User/mcp.json) on macOS or Linux."""
    if is_macos():
        p = Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
    else:
        p = Path.home() / ".config" / "Code" / "User" / "mcp.json"
    p = p.resolve()
    return [p] if p.exists() else []
