import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from loguru import logger as log

from src.config import MCPServerConfig

from .parsers import (
    ImportErrorDetails,
    filter_open_edison_servers,
    parse_mcp_like_json,
    permissive_read_json,
)
from .paths import (
    detect_claude_desktop_config_path,
    find_claude_code_user_all_candidates,
    find_claude_code_user_settings_file,
    find_cursor_user_file,
    find_vscode_user_mcp_file,
)


def import_from_cursor() -> list[MCPServerConfig]:
    # Only support user-level Cursor config
    files = find_cursor_user_file()
    if not files:
        raise ImportErrorDetails(
            "Cursor MCP config not found (~/.cursor/mcp.json).",
            Path.home() / ".cursor" / "mcp.json",
        )
    data = permissive_read_json(files[0])
    servers = parse_mcp_like_json(data, default_enabled=True)
    return filter_open_edison_servers(servers)


def import_from_vscode() -> list[MCPServerConfig]:
    files = find_vscode_user_mcp_file()
    if not files:
        raise ImportErrorDetails(
            "VSCode configuration not found (checked User/mcp.json and User/settings.json)."
        )
    # Try each file; stop at the first that yields MCP servers
    for f in files:
        try:
            log.info("VSCode config detected at: {}", f)
            data = permissive_read_json(f)
            parsed = parse_mcp_like_json(data, default_enabled=True)
            if parsed:
                return filter_open_edison_servers(parsed)
        except Exception as e:
            print(f"Failed reading VSCode config {f}: {e}")
    # If we saw files but none yielded servers, return empty with info
    log.info("No MCP servers found in VSCode config candidates; returning empty list")
    return []


def import_from_claude_code() -> list[MCPServerConfig]:
    # Prefer Claude Code's documented user-level locations if present
    files = find_claude_code_user_all_candidates()
    if not files:
        # Back-compat: also check specific settings.json location
        files = find_claude_code_user_settings_file()
    for f in files:
        try:
            log.info("Claude Code config detected at: {}", f)
            data = permissive_read_json(f)
            parsed = parse_mcp_like_json(data, default_enabled=True)
            if parsed:
                return filter_open_edison_servers(parsed)
        except Exception as e:
            log.warning("Failed reading Claude Code config {}: {}", f, e)

    # No user-level Claude Code config found; return empty per user preference
    log.info("Claude Code config not found; returning empty result (no user-level config found)")
    return []


def import_from_claude_desktop() -> list[MCPServerConfig]:
    """Import from Claude Desktop's config file (claude_desktop_config.json)."""
    path = detect_claude_desktop_config_path()
    if path is None:
        expected = Path.home() / (
            "Library/Application Support/Claude/claude_desktop_config.json"
            if sys.platform == "darwin"
            else ".config/Claude/claude_desktop_config.json"
        )
        print(f"[Claude Desktop] Config not found. Expected at: {expected}")
        # Point to default expected path in error to aid the user
        raise ImportErrorDetails(
            "Claude Desktop configuration not found (claude_desktop_config.json).",
            expected,
        )
    print(f"[Claude Desktop] Using config at: {path}")
    data = permissive_read_json(path)

    # Debug: summarize top-level keys and mcpServers/servers entries
    try:
        top_keys_list = [str(k) for k in data]
        top_keys = ", ".join(sorted(top_keys_list))
        print(f"[Claude Desktop] Top-level keys: {top_keys}")

        servers_node: Any = data.get("mcpServers") or data.get("servers")
        if isinstance(servers_node, dict):
            servers_map: dict[str, Any] = cast(dict[str, Any], servers_node)
            names = sorted([str(k) for k in servers_map])
            print(
                f"[Claude Desktop] mcpServers entries: {len(names)} -> {', '.join(names) if names else '(none)'}"
            )
        elif isinstance(servers_node, list):
            list_items_raw: list[Any] = cast(list[Any], servers_node)
            items_dict: list[dict[str, Any]] = [
                cast(dict[str, Any], it) for it in list_items_raw if isinstance(it, dict)
            ]
            names: list[str] = []
            for it in items_dict:
                name_val: Any = it.get("name")
                if isinstance(name_val, str):
                    names.append(name_val)
                elif name_val is not None:
                    names.append(str(name_val))
            total = len(items_dict)
            print(
                f"[Claude Desktop] servers list entries: {total}; named: {', '.join(sorted(names)) if names else '(none)'}"
            )
        else:
            print("[Claude Desktop] No 'mcpServers' or 'servers' key detected at top level")
    except Exception:
        # Keep import resilient; this is best-effort debug
        pass

    parsed = parse_mcp_like_json(data, default_enabled=True)
    filtered = filter_open_edison_servers(parsed)
    print(f"[Claude Desktop] Parsed server count: {len(filtered)}")
    return filtered


IMPORTERS: dict[str, Callable[..., list[MCPServerConfig]]] = {
    "cursor": import_from_cursor,
    "vscode": import_from_vscode,
    "claude-code": import_from_claude_code,
    "claude-desktop": import_from_claude_desktop,
}
