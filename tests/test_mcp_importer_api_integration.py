from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from scripts.mcp_importer.api import (
    CLIENT,
    detect_clients,
    export_edison_to,
    import_from,
    save_imported_servers,
)


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _sample_mcp_json(server_name: str = "sample") -> dict[str, Any]:
    return {
        "mcpServers": {
            server_name: {
                "command": "echo",
                "args": ["hello"],
                "enabled": True,
            }
        }
    }


def test_import_and_save_cursor(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    editor_file = tmp_path / "cursor" / "mcp.json"
    _write_json(editor_file, _sample_mcp_json("from-cursor"))

    # Patch importer to use our temp file (must patch symbol in importers module)
    monkeypatch.setattr(
        "scripts.mcp_importer.importers.find_cursor_user_file", lambda: [editor_file]
    )

    servers = import_from(CLIENT.CURSOR)
    assert isinstance(servers, list) and len(servers) == 1
    assert getattr(servers[0], "name", "") == "from-cursor"

    # Save into isolated config dir
    config_dir = tmp_path / "config"
    written = save_imported_servers(servers, config_dir=config_dir)
    assert written.exists()
    # Verify wrote our server
    on_disk = json.loads(written.read_text(encoding="utf-8"))
    names = [s.get("name", "") for s in on_disk.get("mcp_servers", [])]
    assert "from-cursor" in names


def test_export_to_cursor_overwrites_to_open_edison(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    editor_file = tmp_path / "cursor" / "mcp.json"
    _write_json(editor_file, _sample_mcp_json("preexisting"))

    # Patch exporter to target our temp file
    monkeypatch.setattr(
        "scripts.mcp_importer.exporters.find_cursor_user_file", lambda: [editor_file]
    )
    monkeypatch.setattr(
        "scripts.mcp_importer.exporters._resolve_cursor_target", lambda: editor_file
    )

    result = export_edison_to(
        CLIENT.CURSOR,
        force=True,
        create_if_missing=True,
        dry_run=False,
    )
    assert result.wrote_changes is True
    assert result.target_path == editor_file

    # New file should contain only open-edison pointing to localhost with header
    data = json.loads(editor_file.read_text(encoding="utf-8"))
    mcp = data.get("mcpServers") or {}
    assert list(mcp.keys()) == ["open-edison"]
    args = mcp["open-edison"].get("args", [])
    assert "http://localhost:3000/mcp/" in args
    assert "Authorization: Bearer dev-api-key-change-me" in args


def test_detect_clients_with_patched_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Patch all detect_* functions to simulate all present
    monkeypatch.setattr(
        "scripts.mcp_importer.paths.detect_cursor_config_path",
        lambda: tmp_path / "fake-cursor.json",
    )
    monkeypatch.setattr(
        "scripts.mcp_importer.paths.detect_vscode_config_path",
        lambda: tmp_path / "fake-vscode.json",
    )
    monkeypatch.setattr(
        "scripts.mcp_importer.paths.detect_claude_code_config_path",
        lambda: tmp_path / "fake-claude.json",
    )

    detected = detect_clients()
    assert CLIENT.CURSOR in detected
    assert CLIENT.VSCODE in detected
    assert CLIENT.CLAUDE_CODE in detected
