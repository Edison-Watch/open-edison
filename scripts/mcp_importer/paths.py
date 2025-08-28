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


def user_app_support_dir(app_name: str) -> Path:
    """Return the OS-specific application support/config directory for an app name.

    - macOS: ~/Library/Application Support/<App>
    - Windows: %APPDATA%/<App> (fallback to ~/AppData/Roaming/<App>)
    - Linux: $XDG_CONFIG_HOME/<app-lower> or ~/.config/<app-lower>
    """
    if is_macos():
        return Path.home() / "Library" / "Application Support" / app_name
    if is_windows():
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / app_name
    # Linux / POSIX
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".config"
    return base / app_name.lower().replace(" ", "-")


def find_cursor_user_file() -> list[Path]:
    """Find user-level Cursor MCP config (~/.cursor/mcp.json)."""
    p = (Path.home() / ".cursor" / "mcp.json").resolve()
    return [p] if p.exists() else []


def find_windsurf_files() -> list[Path]:
    candidates: list[Path] = []
    if is_macos():
        candidates.append(Path.home() / ".codeium" / "windsurf" / "mcp_config.json")
    elif is_windows():
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        candidates.append(base / "Codeium" / "windsurf" / "mcp_config.json")
    else:  # linux
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg).expanduser() if xdg else Path.home() / ".config"
        candidates.append(base / ".codeium" / "windsurf" / "mcp_config.json")
    return [p for p in candidates if p.exists()]


def find_cline_files() -> list[Path]:
    editors = ["Cursor", "Code"]
    results: list[Path] = []
    for editor in editors:
        if is_macos():
            base = (
                Path.home() / "Library" / "Application Support" / editor / "User" / "globalStorage"
            )
            p = base / "saoudrizwan.claude-dev" / "settings" / "cline_mcp_settings.json"
        elif is_windows():
            appdata = os.environ.get("APPDATA")
            base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
            p = (
                base
                / editor
                / "User"
                / "globalStorage"
                / "saoudrizwan.claude-dev"
                / "settings"
                / "cline_mcp_settings.json"
            )
        else:
            base = Path.home() / ".config" / editor / "User" / "globalStorage"
            p = base / "saoudrizwan.claude-dev" / "settings" / "cline_mcp_settings.json"
        if p.exists():
            results.append(p)
    return results


def find_claude_desktop_file() -> list[Path]:
    base = user_app_support_dir("Claude")
    p = base / "claude_desktop_config.json"
    return [p] if p.exists() else []


def find_vscode_settings() -> list[Path]:
    if is_macos():
        p = Path.home() / "Library" / "Application Support" / "Code" / "User" / "settings.json"
    elif is_windows():
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        p = base / "Code" / "User" / "settings.json"
    else:
        p = Path.home() / ".config" / "Code" / "User" / "settings.json"
    return [p] if p.exists() else []
