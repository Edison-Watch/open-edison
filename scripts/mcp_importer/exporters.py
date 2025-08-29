from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger as log

from .paths import find_cursor_user_file, find_vscode_user_mcp_file, is_macos, is_windows


@dataclass
class ExportResult:
    target_path: Path
    backup_path: Path | None
    wrote_changes: bool
    dry_run: bool


class ExportError(Exception):
    pass


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    _ensure_parent_dir(path)
    tmp_fd, tmp_path = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        # Use replace to be atomic on POSIX
        Path(tmp_path).replace(path)
    finally:
        try:
            if Path(tmp_path).exists():
                Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


def _read_json_or_error(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise ExportError(f"Malformed JSON at {path}: {e}") from e
    if not isinstance(data, dict):
        raise ExportError(f"Expected top-level JSON object at {path}")
    return data


def _build_open_edison_server(
    *,
    name: str,
    url: str,
    api_key: str,
) -> dict[str, Any]:
    return {
        name: {
            "command": "npx",
            "args": [
                "-y",
                "mcp-remote",
                url,
                "--header",
                f"Authorization:Bearer {api_key}",
                "--transport",
                "http-only",
                "--allow-http",
            ],
            "enabled": True,
        }
    }


def _is_already_open_edison(
    config_obj: dict[str, Any], *, url: str, api_key: str, name: str
) -> bool:
    servers_node = config_obj.get("mcpServers") or config_obj.get("servers")
    if not isinstance(servers_node, dict):
        return False
    # Must be exactly one server
    if len(servers_node) != 1:
        return False
    only_name, only_spec = next(iter(servers_node.items()))
    if only_name != name or not isinstance(only_spec, dict):
        return False
    if only_spec.get("command") != "npx":
        return False
    args = only_spec.get("args")
    if not isinstance(args, list):
        return False
    args_str = [str(a) for a in args]
    expected_header = f"Authorization:Bearer {api_key}"
    return (
        url in args_str
        and expected_header in args_str
        and "mcp-remote" in args_str
        and "--transport" in args_str
        and "http-only" in args_str
    )


def export_to_cursor(
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> ExportResult:
    """Export editor config for Cursor to point solely to Open Edison.

    Behavior:
    - Back up existing file if present.
    - Abort on malformed JSON.
    - If file does not exist, require create_if_missing=True or raise ExportError.
    - Write a minimal mcpServers object with a single Open Edison server.
    - Atomic writes.
    """

    if is_windows():
        raise ExportError("Windows is not supported. Use macOS or Linux.")

    existing_candidates = find_cursor_user_file()
    if existing_candidates:
        target_path = existing_candidates[0]
    else:
        target_path = (Path.home() / ".cursor" / "mcp.json").resolve()

    backup_path: Path | None = None

    if target_path.exists():
        # Validate existing JSON; abort if malformed
        _ = _read_json_or_error(target_path)
    else:
        if not create_if_missing:
            raise ExportError(
                f"Cursor config not found at {target_path}. Refusing to create without confirmation."
            )

    # Build the minimal config
    new_config: dict[str, Any] = {
        "mcpServers": _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    }

    # If already configured exactly as desired and not forcing, no-op
    if target_path.exists():
        try:
            current = _read_json_or_error(target_path)
            if (
                _is_already_open_edison(current, url=url, api_key=api_key, name=server_name)
                and not force
            ):
                log.info(
                    "Cursor is already configured to use Open Edison. Skipping (use --force to rewrite)."
                )
                return ExportResult(
                    target_path=target_path, backup_path=None, wrote_changes=False, dry_run=dry_run
                )
        except ExportError:
            # Malformed was already raised earlier; this is defensive.
            raise

    # Prepare backup if file exists
    if target_path.exists():
        backup_path = target_path.with_name(target_path.name + f".bak-{_timestamp()}")
        if dry_run:
            log.info("[dry-run] Would back up {} -> {}", target_path, backup_path)
        else:
            _ensure_parent_dir(backup_path)
            shutil.copy2(target_path, backup_path)
            log.info("Backed up {} -> {}", target_path, backup_path)

    # Write new config
    if dry_run:
        log.info("[dry-run] Would write minimal Cursor MCP config to {}", target_path)
        log.debug("[dry-run] New JSON: {}", json.dumps(new_config, indent=2))
        return ExportResult(
            target_path=target_path, backup_path=backup_path, wrote_changes=False, dry_run=True
        )

    _atomic_write_json(target_path, new_config)
    log.info("Wrote Cursor MCP config to {}", target_path)
    return ExportResult(
        target_path=target_path, backup_path=backup_path, wrote_changes=True, dry_run=False
    )


def export_to_vscode(
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> ExportResult:
    """Export editor config for VS Code to point solely to Open Edison.

    Uses the user-level `mcp.json` path used by the importer.

    Behavior mirrors Cursor export:
    - Back up existing file if present.
    - Abort on malformed JSON.
    - If file does not exist, require create_if_missing=True or raise ExportError.
    - Write a minimal mcpServers object with a single Open Edison server.
    - Atomic writes.
    """

    if is_windows():
        raise ExportError("Windows is not supported. Use macOS or Linux.")

    existing_candidates = find_vscode_user_mcp_file()
    if existing_candidates:
        target_path = existing_candidates[0]
    else:
        if is_macos():
            target_path = (
                Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
            ).resolve()
        else:
            target_path = (Path.home() / ".config" / "Code" / "User" / "mcp.json").resolve()

    backup_path: Path | None = None

    if target_path.exists():
        # Validate existing JSON; abort if malformed
        _ = _read_json_or_error(target_path)
    else:
        if not create_if_missing:
            raise ExportError(
                f"VS Code MCP config not found at {target_path}. Refusing to create without confirmation."
            )

    # Build the minimal config
    new_config: dict[str, Any] = {
        "mcpServers": _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    }

    # If already configured exactly as desired and not forcing, no-op
    if target_path.exists():
        try:
            current = _read_json_or_error(target_path)
            if (
                _is_already_open_edison(current, url=url, api_key=api_key, name=server_name)
                and not force
            ):
                log.info(
                    "VS Code is already configured to use Open Edison. Skipping (use --force to rewrite)."
                )
                return ExportResult(
                    target_path=target_path, backup_path=None, wrote_changes=False, dry_run=dry_run
                )
        except ExportError:
            # Malformed was already raised earlier; this is defensive.
            raise

    # Prepare backup if file exists
    if target_path.exists():
        backup_path = target_path.with_name(target_path.name + f".bak-{_timestamp()}")
        if dry_run:
            log.info("[dry-run] Would back up {} -> {}", target_path, backup_path)
        else:
            _ensure_parent_dir(backup_path)
            shutil.copy2(target_path, backup_path)
            log.info("Backed up {} -> {}", target_path, backup_path)

    # Write new config
    if dry_run:
        log.info("[dry-run] Would write minimal VS Code MCP config to {}", target_path)
        log.debug("[dry-run] New JSON: {}", json.dumps(new_config, indent=2))
        return ExportResult(
            target_path=target_path, backup_path=backup_path, wrote_changes=False, dry_run=True
        )

    _atomic_write_json(target_path, new_config)
    log.info("Wrote VS Code MCP config to {}", target_path)
    return ExportResult(
        target_path=target_path, backup_path=backup_path, wrote_changes=True, dry_run=False
    )
