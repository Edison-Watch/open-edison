from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from loguru import logger as log

from .parsers import ImportErrorDetails, parse_mcp_like_json, safe_read_json
from .paths import find_cursor_user_file, find_vscode_settings

MCPServerConfigT = Any


def import_from_cursor() -> list[MCPServerConfigT]:
    # Only support user-level Cursor config
    files = find_cursor_user_file()
    if not files:
        raise ImportErrorDetails(
            "Cursor MCP config not found (~/.cursor/mcp.json).",
            Path.home() / ".cursor" / "mcp.json",
        )
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


IMPORTERS: dict[str, Callable[..., list[MCPServerConfigT]]] = {
    "cursor": import_from_cursor,
    "vscode": import_from_vscode,
    "claude-code": import_from_claude_code,
}
