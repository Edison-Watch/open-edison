# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingImports=false, reportUnknownMemberType=false

import json
from pathlib import Path
from typing import Any, cast

from loguru import logger as log

from src.config import MCPServerConfig


# Import Open Edison types
def _new_mcp_server_config(
    *,
    name: str,
    command: str,
    args: list[str],
    env: dict[str, str] | None,
    enabled: bool,
    roots: list[str] | None,
) -> Any:
    """Runtime-constructed MCPServerConfig without static import coupling."""

    return MCPServerConfig(
        name=name,
        command=command,
        args=args,
        env=env or {},
        enabled=enabled,
        roots=roots,
    )


class ImportErrorDetails(Exception):  # noqa: N818
    def __init__(self, message: str, path: Path | None = None):
        super().__init__(message)
        self.path = path


def safe_read_json(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            loaded = json.load(f)
    except Exception as e:
        raise ImportErrorDetails(f"Failed to read JSON from {path}: {e}", path) from e

    if not isinstance(loaded, dict):
        raise ImportErrorDetails(f"Expected JSON object at {path}", path)
    data: dict[str, Any] = cast(dict[str, Any], loaded)
    return data


def _coerce_server_entry(name: str, node: dict[str, Any], default_enabled: bool) -> Any:
    command_val = node.get("command", "")
    command = str(command_val) if isinstance(command_val, str) else ""

    args_raw = node.get("args", [])
    if not isinstance(args_raw, list):
        args_raw = []

    # Some tools provide combined commandWithArgs
    if command == "" and isinstance(node.get("commandWithArgs"), list):
        cmd_with_args = [str(p) for p in node["commandWithArgs"]]
        if cmd_with_args:
            command = cmd_with_args[0]
            args_raw = cmd_with_args[1:]

    args: list[str] = [str(a) for a in args_raw]

    env_raw = node.get("env") or node.get("environment") or {}
    env: dict[str, str] = {}
    if isinstance(env_raw, dict):
        for k, v in env_raw.items():
            env[str(k)] = str(v)

    enabled = bool(node.get("enabled", default_enabled))

    roots_raw = node.get("roots") or node.get("rootPaths") or []
    roots: list[str] | None = None
    if isinstance(roots_raw, list):
        roots = [str(r) for r in roots_raw]
        if len(roots) == 0:
            roots = None

    return _new_mcp_server_config(
        name=name,
        command=command,
        args=args,
        env=env,
        enabled=enabled,
        roots=roots,
    )


def _collect_from_dict(node_dict: dict[str, Any], default_enabled: bool) -> list[Any]:
    results: list[Any] = []
    for name_key, spec_obj in node_dict.items():
        if isinstance(spec_obj, dict):
            results.append(_coerce_server_entry(str(name_key), spec_obj, default_enabled))
    return results


def _collect_from_list(node_list: list[Any], default_enabled: bool) -> list[Any]:
    results: list[Any] = []
    for spec_obj in node_list:
        if isinstance(spec_obj, dict) and "name" in spec_obj:
            name_val_obj = spec_obj.get("name")
            name_str = str(name_val_obj) if name_val_obj is not None else ""
            results.append(_coerce_server_entry(name_str, spec_obj, default_enabled))
    return results


def _collect_top_level(data: dict[str, Any], default_enabled: bool) -> list[Any]:
    results: list[Any] = []
    for key in ("mcpServers", "servers"):
        node = data.get(key)
        if isinstance(node, dict):
            results.extend(_collect_from_dict(node, default_enabled))
        elif isinstance(node, list):
            results.extend(_collect_from_list(node, default_enabled))
    return results


def _collect_nested(data: dict[str, Any], default_enabled: bool) -> list[Any]:
    results: list[Any] = []
    for _k, v in data.items():
        # If nested dict, recurse regardless of key to catch structures like 'projects'
        if isinstance(v, dict):
            results.extend(parse_mcp_like_json(v, default_enabled=default_enabled))
        # If nested list, recurse into dict items
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    results.extend(parse_mcp_like_json(item, default_enabled=default_enabled))
    return results


def parse_mcp_like_json(data: dict[str, Any], default_enabled: bool = True) -> list[Any]:
    # First, try top-level keys
    top_level = _collect_top_level(data, default_enabled)
    if top_level:
        return top_level

    # Then, try nested structures heuristically
    nested = _collect_nested(data, default_enabled)
    if not nested:
        log.debug("No MCP-like entries detected in provided data")
    return nested
