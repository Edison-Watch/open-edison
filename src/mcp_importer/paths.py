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


def _vscode_base_dirs() -> list[Path]:
    """Return likely VSCode user base directories for different distributions."""
    home = Path.home()
    vscode_config_base = (
        home / "Library" / "Application Support" if is_macos() else home / ".config"
    )
    return [
        x
        for x in [
            vscode_config_base / "Code",
            vscode_config_base / "Code - Insiders",
            vscode_config_base / "VSCodium",
            vscode_config_base / "Code - OSS",
        ]
        if x.exists()
    ]


def find_vscode_user_mcp_file() -> list[Path]:
    """Find VSCode user-level MCP config: prefer User/mcp.json; fall back to User/settings.json."""
    results: list[Path] = []
    for base in _vscode_base_dirs():
        for filename in ("mcp.json", "settings.json"):
            candidate = (base / "User" / filename).resolve()
            if candidate.exists():
                results.append(candidate)
    return results


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
    # Prefer the first base dir; target mcp.json under User/
    existing_base_dir = next((base for base in _vscode_base_dirs() if base.exists()), None)
    if existing_base_dir:
        return (existing_base_dir / "User" / "mcp.json").resolve()
    raise RuntimeError("No VSCode base directory found! Are you sure VSCode is installed?")


def get_default_cursor_config_path() -> Path:
    return (Path.home() / ".cursor" / "mcp.json").resolve()


def detect_claude_code_config_path() -> Path | None:
    candidates = find_claude_code_user_all_candidates()
    return candidates[0] if candidates else None


def get_default_claude_code_config_path() -> Path:
    # Prefer top-level ~/.claude.json as default create target
    return (Path.home() / ".claude.json").resolve()


def detect_claude_desktop_config_path() -> Path | None:
    """Detect Claude Desktop user-level config file.

    macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
    Linux: ~/.config/Claude/claude_desktop_config.json
    """
    home = Path.home()
    candidates: list[Path] = []
    if is_macos():
        candidates.append(
            (
                home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
            ).resolve()
        )
    else:
        # Linux path per docs
        candidates.append((home / ".config" / "Claude" / "claude_desktop_config.json").resolve())
    for p in candidates:
        if p.exists():
            return p
    return None


def get_default_claude_desktop_config_path() -> Path:
    """Return the default path to write Claude Desktop config if creating new."""
    home = Path.home()
    if is_macos():
        return (
            home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
        ).resolve()
    # Linux default
    return (home / ".config" / "Claude" / "claude_desktop_config.json").resolve()
