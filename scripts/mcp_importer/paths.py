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


def find_claude_code_user_settings_file() -> list[Path]:
    """Find Claude Code user-level settings (~/.claude/settings.json)."""
    p = (Path.home() / ".claude" / "settings.json").resolve()
    return [p] if p.exists() else []


def find_claude_code_user_all_candidates() -> list[Path]:
    """Return ordered list of Claude Code user-level MCP config candidates.

    Based on docs, check in priority order:
      - ~/.claude.json (primary user-level)
      - ~/.claude/settings.json
      - ~/.claude/settings.local.json
      - ~/.claude/mcp_servers.json
    """
    home = Path.home()
    candidates: list[Path] = [
        home / ".claude.json",
        home / ".claude" / "settings.json",
        home / ".claude" / "settings.local.json",
        home / ".claude" / "mcp_servers.json",
    ]
    existing: list[Path] = []
    for p in candidates:
        rp = p.resolve()
        if rp.exists():
            existing.append(rp)
    return existing
