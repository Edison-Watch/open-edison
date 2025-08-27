from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from loguru import logger as log

from .parsers import ImportErrorDetails, parse_mcp_like_json, safe_read_json
from .paths import (
    find_claude_desktop_file,
    find_cline_files,
    find_cursor_project_file,
    find_cursor_user_file,
    find_vscode_settings,
    find_windsurf_files,
)

MCPServerConfigT = Any


def import_from_cursor(project_dir: Path | None = None) -> list[MCPServerConfigT]:
    # Prefer project-level config if provided
    files = find_cursor_project_file(project_dir) if project_dir else []
    if not files:
        # Fallback to user-level config
        files = find_cursor_user_file()
    if not files:
        raise ImportErrorDetails(
            "Cursor MCP config not found (checked project .cursor/mcp.json and ~/.cursor/mcp.json).",
            project_dir if project_dir else Path.home() / ".cursor" / "mcp.json",
        )
    data = safe_read_json(files[0])
    return parse_mcp_like_json(data, default_enabled=True)


def import_from_windsurf() -> list[MCPServerConfigT]:
    files = find_windsurf_files()
    if not files:
        raise ImportErrorDetails("Windsurf mcp_config.json not found in default locations.")
    data = safe_read_json(files[0])
    return parse_mcp_like_json(data, default_enabled=True)


def import_from_cline() -> list[MCPServerConfigT]:
    files = find_cline_files()
    if not files:
        raise ImportErrorDetails("Cline settings file not found under host editor globalStorage.")
    data = safe_read_json(files[0])
    return parse_mcp_like_json(data, default_enabled=True)


def import_from_claude_desktop() -> list[MCPServerConfigT]:
    files = find_claude_desktop_file()
    if not files:
        raise ImportErrorDetails("Claude Desktop config not found in OS app data.")
    data = safe_read_json(files[0])
    return parse_mcp_like_json(data, default_enabled=True)


def import_from_vscode() -> list[MCPServerConfigT]:
    files = find_vscode_settings()
    if not files:
        raise ImportErrorDetails("VSCode settings.json not found; cannot heuristically import.")
    data = safe_read_json(files[0])
    servers = parse_mcp_like_json(data, default_enabled=True)
    if not servers:
        log.warning("No MCP-like entries found in VSCode settings.json. This may be expected.")
    return servers


def import_from_claude_code() -> list[MCPServerConfigT]:
    # No stable published path; try VSCode heuristic
    return import_from_vscode()


def import_from_gemini_cli() -> list[MCPServerConfigT]:
    log.warning("Gemini CLI MCP config location not standardized; nothing to import.")
    return []


def import_from_codex() -> list[MCPServerConfigT]:
    log.warning("OpenAI Codex does not provide MCP configs; nothing to import.")
    return []


IMPORTERS: dict[str, Callable[..., list[MCPServerConfigT]]] = {
    "cursor": import_from_cursor,
    "windsurf": import_from_windsurf,
    "cline": import_from_cline,
    "claude-desktop": import_from_claude_desktop,
    "vscode": import_from_vscode,
    "claude-code": import_from_claude_code,
    "gemini-cli": import_from_gemini_cli,
    "codex": import_from_codex,
}
