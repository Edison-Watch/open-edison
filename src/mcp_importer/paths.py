import os
import sys
from pathlib import Path


def is_windows() -> bool:
    return os.name == "nt"


def is_macos() -> bool:
    return sys.platform == "darwin"


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


# Shared utils for CLI import/export


def detect_cursor_config_path() -> Path | None:
    files = find_cursor_user_file()
    return files[0] if files else None


def detect_vscode_config_path() -> Path | None:
    files = find_vscode_user_mcp_file()
    return files[0] if files else None


def get_default_vscode_config_path() -> Path:
    if is_macos():
        return (
            Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
        ).resolve()
    return (Path.home() / ".config" / "Code" / "User" / "mcp.json").resolve()


def get_default_cursor_config_path() -> Path:
    return (Path.home() / ".cursor" / "mcp.json").resolve()


def detect_claude_code_config_path() -> Path | None:
    candidates = find_claude_code_user_all_candidates()
    return candidates[0] if candidates else None


def get_default_claude_code_config_path() -> Path:
    # Prefer top-level ~/.claude.json as default create target
    return (Path.home() / ".claude.json").resolve()
