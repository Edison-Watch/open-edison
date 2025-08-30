# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
from enum import Enum
from pathlib import Path
from typing import Any

from src.config import Config, MCPServerConfig, get_config_json_path
from src.mcp_importer import paths as _paths
from src.mcp_importer.exporters import export_to_claude_code, export_to_cursor, export_to_vscode
from src.mcp_importer.importers import (
    import_from_claude_code as _import_from_claude_code,
)
from src.mcp_importer.importers import (
    import_from_cursor as _import_from_cursor,
)
from src.mcp_importer.importers import (
    import_from_vscode as _import_from_vscode,
)
from src.mcp_importer.merge import MergePolicy, merge_servers


class CLIENT(str, Enum):
    CURSOR = "cursor"
    VSCODE = "vscode"
    CLAUDE_CODE = "claude-code"


def detect_clients() -> set[CLIENT]:
    detected: set[CLIENT] = set()
    if _paths.detect_cursor_config_path() is not None:
        detected.add(CLIENT.CURSOR)
    if _paths.detect_vscode_config_path() is not None:
        detected.add(CLIENT.VSCODE)
    if _paths.detect_claude_code_config_path() is not None:
        detected.add(CLIENT.CLAUDE_CODE)
    return detected


import_cursor = _import_from_cursor
import_vscode = _import_from_vscode
import_claude_code = _import_from_claude_code


def import_from(client: CLIENT) -> list[MCPServerConfig]:
    if client == CLIENT.CURSOR:
        return import_cursor()
    if client == CLIENT.VSCODE:
        return import_vscode()
    if client == CLIENT.CLAUDE_CODE:
        return import_claude_code()
    raise ValueError(f"Unsupported client: {client}")


def save_imported_servers(
    servers: list[MCPServerConfig],
    *,
    merge_policy: str = MergePolicy.SKIP,
    config_dir: Path | None = None,
) -> Path:
    target_path: Path = (
        get_config_json_path() if config_dir is None else (Path(config_dir) / "config.json")
    )
    cfg: Config = Config(target_path)
    merged = merge_servers(existing=cfg.mcp_servers, imported=servers, policy=merge_policy)
    cfg.mcp_servers = merged
    cfg.save(target_path)
    return target_path


def export_edison_to(
    client: CLIENT,
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> Any:
    match client:
        case CLIENT.CURSOR:
            return export_to_cursor(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )
        case CLIENT.VSCODE:
            return export_to_vscode(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )
        case CLIENT.CLAUDE_CODE:
            return export_to_claude_code(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )
