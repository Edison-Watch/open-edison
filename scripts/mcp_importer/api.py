from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
from enum import Enum
from typing import Any

from .exporters import export_to_claude_code, export_to_cursor, export_to_vscode
from .importers import IMPORTERS
from .paths import (
    detect_claude_code_config_path,
    detect_cursor_config_path,
    detect_vscode_config_path,
)


class CLIENT(str, Enum):
    CURSOR = "cursor"
    VSCODE = "vscode"
    CLAUDE_CODE = "claude-code"


def detect_clients() -> set[CLIENT]:
    detected: set[CLIENT] = set()
    if detect_cursor_config_path() is not None:
        detected.add(CLIENT.CURSOR)
    if detect_vscode_config_path() is not None:
        detected.add(CLIENT.VSCODE)
    if detect_claude_code_config_path() is not None:
        detected.add(CLIENT.CLAUDE_CODE)
    return detected


def import_from(client: CLIENT) -> list[Any]:
    importer = IMPORTERS.get(client.value)
    if importer is None:
        raise ValueError(f"Unsupported client: {client}")
    return importer()


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
    if client == CLIENT.CURSOR:
        return export_to_cursor(
            url=url,
            api_key=api_key,
            server_name=server_name,
            dry_run=dry_run,
            force=force,
            create_if_missing=create_if_missing,
        )
    if client == CLIENT.VSCODE:
        return export_to_vscode(
            url=url,
            api_key=api_key,
            server_name=server_name,
            dry_run=dry_run,
            force=force,
            create_if_missing=create_if_missing,
        )
    if client == CLIENT.CLAUDE_CODE:
        return export_to_claude_code(
            url=url,
            api_key=api_key,
            server_name=server_name,
            dry_run=dry_run,
            force=force,
            create_if_missing=create_if_missing,
        )
    raise ValueError(f"Unsupported client: {client}")
