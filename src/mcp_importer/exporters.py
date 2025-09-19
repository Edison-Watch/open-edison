import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from loguru import logger as log

from .paths import (
    detect_claude_desktop_config_path,
    find_claude_code_user_all_candidates,
    find_cursor_user_file,
    find_vscode_user_mcp_file,
    get_default_claude_desktop_config_path,
    is_macos,
    is_windows,
)


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
    typed_data: dict[str, Any] = cast(dict[str, Any], data)
    return typed_data


def _require_supported_os() -> None:
    if is_windows():
        raise ExportError("Windows is not supported. Use macOS or Linux.")


def _resolve_cursor_target() -> Path:
    existing = find_cursor_user_file()
    return existing[0] if existing else (Path.home() / ".cursor" / "mcp.json").resolve()


def _resolve_vscode_target() -> Path:
    existing = find_vscode_user_mcp_file()
    if existing:
        return existing[0]
    if is_macos():
        return (
            Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
        ).resolve()
    return (Path.home() / ".config" / "Code" / "User" / "mcp.json").resolve()


def _resolve_claude_code_target() -> Path:
    existing = find_claude_code_user_all_candidates()
    if existing:
        return existing[0]
    return (Path.home() / ".claude.json").resolve()


def _resolve_claude_desktop_target() -> Path:
    existing = detect_claude_desktop_config_path()
    if existing:
        return existing
    return get_default_claude_desktop_config_path()


def _open_with_os(path: Path) -> None:
    try:
        if is_macos():
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to open {} via OS: {}", path, e)


def _find_dxt_candidates() -> list[Path]:
    """Return plausible locations for the packaged DXT file.

    - Repo/dev: <repo_root>/desktop_ext/open-edison-connector.dxt
    - Packaged under src: <site-packages>/src/desktop_ext/open-edison-connector.dxt (if included)
    - Packaged at project root level inside site-packages: <site-packages>/desktop_ext/open-edison-connector.dxt
    """
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    candidates: list[Path] = [
        # Repo/dev locations
        (repo_root / "desktop_ext" / "open-edison-connector.dxt").resolve(),
        (repo_root / "desktop_ext" / "desktop_ext.dxt").resolve(),
        (repo_root / "open-edison-connector.dxt").resolve(),
        # Installed wheel locations (desktop_ext at site-packages root)
        (here.parents[1] / "desktop_ext" / "open-edison-connector.dxt").resolve(),
        (here.parents[3] / "desktop_ext" / "open-edison-connector.dxt").resolve()
        if len(here.parents) >= 4
        else Path("/nonexistent"),
    ]
    return [p for p in candidates if p.exists()]


def _validate_or_confirm_create(target_path: Path, *, create_if_missing: bool, label: str) -> None:
    if target_path.exists():
        _read_json_or_error(target_path)
        return
    if not create_if_missing:
        raise ExportError(
            f"{label} config not found at {target_path}. Refusing to create without confirmation."
        )


def _skip_if_already_configured(
    target_path: Path,
    *,
    url: str,
    api_key: str,
    name: str,
    force: bool,
    dry_run: bool,
    label: str,
) -> ExportResult | None:
    if not target_path.exists():
        return None
    current = _read_json_or_error(target_path)
    if _is_already_open_edison(current, url=url, api_key=api_key, name=name) and not force:
        log.info(
            "{} is already configured to use Open Edison. Skipping (use --force to rewrite).", label
        )
        return ExportResult(
            target_path=target_path, backup_path=None, wrote_changes=False, dry_run=dry_run
        )
    return None


def _backup_if_exists(target_path: Path, *, dry_run: bool) -> Path | None:
    if not target_path.exists():
        return None
    backup_path = target_path.with_name(target_path.name + f".bak-{_timestamp()}")
    if dry_run:
        log.info("[dry-run] Would back up {} -> {}", target_path, backup_path)
        return backup_path
    _ensure_parent_dir(backup_path)
    shutil.copy2(target_path, backup_path)
    log.info("Backed up {} -> {}", target_path, backup_path)
    return backup_path


def _write_config(
    target_path: Path,
    *,
    new_config: dict[str, Any],
    backup_path: Path | None,
    dry_run: bool,
    label: str,
) -> ExportResult:
    if dry_run:
        log.info("[dry-run] Would write minimal {} MCP config to {}", label, target_path)
        log.debug("[dry-run] New JSON: {}", json.dumps(new_config, indent=2))
        return ExportResult(
            target_path=target_path, backup_path=backup_path, wrote_changes=False, dry_run=True
        )
    _atomic_write_json(target_path, new_config)
    log.info("Wrote {} MCP config to {}", label, target_path)
    return ExportResult(
        target_path=target_path, backup_path=backup_path, wrote_changes=True, dry_run=False
    )


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
                f"Authorization: Bearer {api_key}",
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
    servers_raw: Any = config_obj.get("mcpServers") or config_obj.get("servers")
    if not isinstance(servers_raw, dict):
        return False
    servers_node: dict[str, Any] = cast(dict[str, Any], servers_raw)
    # Must be exactly one server
    if len(servers_node) != 1:
        return False
    only_name, only_spec_any = next(iter(servers_node.items()))
    if only_name != name or not isinstance(only_spec_any, dict):
        return False
    only_spec: dict[str, Any] = cast(dict[str, Any], only_spec_any)
    cmd_val_any: Any = only_spec.get("command")
    if cmd_val_any != "npx":
        return False
    args_obj_any: Any = only_spec.get("args")
    if not isinstance(args_obj_any, list):
        return False
    args_list: list[Any] = cast(list[Any], args_obj_any)
    args_str = [str(a) for a in args_list]
    expected_header = f"Authorization: Bearer {api_key}"
    return (
        url in args_str
        and expected_header in args_str
        and "mcp-remote" in args_str
        and "--transport" in args_str
        and "http-only" in args_str
    )


# --- Restore helpers and functions ---


@dataclass
class RestoreResult:
    target_path: Path
    restored_from_backup: Path | None
    wrote_changes: bool
    dry_run: bool
    removed_open_edison_only: bool


def _find_latest_backup(target_path: Path) -> Path | None:
    parent = target_path.parent
    prefix = target_path.name + ".bak-"
    candidates: list[Path] = [p for p in parent.glob(target_path.name + ".bak-*") if p.is_file()]
    if not candidates:
        return None

    # Sort by timestamp portion descending (string sort works with our format)
    def _key(p: Path) -> str:
        return p.name.replace(prefix, "")

    candidates.sort(key=_key, reverse=True)
    return candidates[0]


def _is_open_edison_singleton(config_obj: dict[str, Any], *, name: str) -> bool:
    servers_raw: Any = config_obj.get("mcpServers") or config_obj.get("servers")
    if not isinstance(servers_raw, dict):
        return False
    servers_node: dict[str, Any] = cast(dict[str, Any], servers_raw)
    if len(servers_node) != 1:
        return False
    only_name, only_spec_any = next(iter(servers_node.items()))
    if only_name != name or not isinstance(only_spec_any, dict):
        return False
    only_spec: dict[str, Any] = cast(dict[str, Any], only_spec_any)
    cmd_val_any: Any = only_spec.get("command")
    if cmd_val_any != "npx":
        return False
    args_obj_any: Any = only_spec.get("args")
    if not isinstance(args_obj_any, list):
        return False
    args_list: list[Any] = cast(list[Any], args_obj_any)
    args_str = [str(a) for a in args_list]
    return "mcp-remote" in args_str


def _restore_from_backup_or_remove(
    *,
    target_path: Path,
    label: str,
    key_name: str,
    server_name: str,
    dry_run: bool,
) -> RestoreResult:
    backup = _find_latest_backup(target_path)
    if backup is not None:
        if dry_run:
            log.info("[dry-run] Would restore {} from backup {}", label, backup)
            return RestoreResult(
                target_path=target_path,
                restored_from_backup=backup,
                wrote_changes=False,
                dry_run=True,
                removed_open_edison_only=False,
            )
        _ensure_parent_dir(target_path)
        shutil.copy2(backup, target_path)
        log.info("Restored {} from backup {}", label, backup)
        return RestoreResult(
            target_path=target_path,
            restored_from_backup=backup,
            wrote_changes=True,
            dry_run=False,
            removed_open_edison_only=False,
        )

    # No backup found; as a safety, remove the Open Edison-only MCP section if it exactly matches
    if not target_path.exists():
        return RestoreResult(
            target_path=target_path,
            restored_from_backup=None,
            wrote_changes=False,
            dry_run=dry_run,
            removed_open_edison_only=False,
        )
    current = _read_json_or_error(target_path)
    if _is_open_edison_singleton(current, name=server_name):
        if dry_run:
            log.info("[dry-run] Would remove Open Edison-only MCP section from {}", label)
            return RestoreResult(
                target_path=target_path,
                restored_from_backup=None,
                wrote_changes=False,
                dry_run=True,
                removed_open_edison_only=True,
            )
        if key_name in current:
            # Remove entire MCP section
            current.pop(key_name, None)
        _atomic_write_json(target_path, current)
        log.info("Removed Open Edison-only MCP section from {}", label)
        return RestoreResult(
            target_path=target_path,
            restored_from_backup=None,
            wrote_changes=True,
            dry_run=False,
            removed_open_edison_only=True,
        )
    # Nothing to do
    return RestoreResult(
        target_path=target_path,
        restored_from_backup=None,
        wrote_changes=False,
        dry_run=dry_run,
        removed_open_edison_only=False,
    )


def restore_cursor(*, server_name: str = "open-edison", dry_run: bool = False) -> RestoreResult:
    _require_supported_os()
    target_path = _resolve_cursor_target()
    return _restore_from_backup_or_remove(
        target_path=target_path,
        label="Cursor",
        key_name="mcpServers",
        server_name=server_name,
        dry_run=dry_run,
    )


def restore_vscode(*, server_name: str = "open-edison", dry_run: bool = False) -> RestoreResult:
    _require_supported_os()
    target_path = _resolve_vscode_target()
    return _restore_from_backup_or_remove(
        target_path=target_path,
        label="VS Code",
        key_name="servers",
        server_name=server_name,
        dry_run=dry_run,
    )


def restore_claude_code(
    *, server_name: str = "open-edison", dry_run: bool = False
) -> RestoreResult:
    _require_supported_os()
    target_path = _resolve_claude_code_target()
    # Claude Code uses general settings format; MCP key is "mcpServers"
    return _restore_from_backup_or_remove(
        target_path=target_path,
        label="Claude Code",
        key_name="mcpServers",
        server_name=server_name,
        dry_run=dry_run,
    )


def restore_claude_desktop(
    *, server_name: str = "open-edison", dry_run: bool = False
) -> RestoreResult:
    _require_supported_os()
    target_path = _resolve_claude_desktop_target()
    # Claude Desktop uses general settings format; MCP key is "mcpServers"
    return _restore_from_backup_or_remove(
        target_path=target_path,
        label="Claude Desktop",
        key_name="mcpServers",
        server_name=server_name,
        dry_run=dry_run,
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

    _require_supported_os()
    target_path = _resolve_cursor_target()

    backup_path: Path | None = None

    _validate_or_confirm_create(target_path, create_if_missing=create_if_missing, label="Cursor")

    # Build the minimal config
    new_config: dict[str, Any] = {
        "mcpServers": _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    }

    # If already configured exactly as desired and not forcing, no-op
    maybe_skip = _skip_if_already_configured(
        target_path,
        url=url,
        api_key=api_key,
        name=server_name,
        force=force,
        dry_run=dry_run,
        label="Cursor",
    )
    if maybe_skip is not None:
        return maybe_skip

    # Prepare backup if file exists
    backup_path = _backup_if_exists(target_path, dry_run=dry_run)

    # Write new config
    return _write_config(
        target_path,
        new_config=new_config,
        backup_path=backup_path,
        dry_run=dry_run,
        label="Cursor",
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

    _require_supported_os()
    target_path = _resolve_vscode_target()

    backup_path: Path | None = None

    _validate_or_confirm_create(target_path, create_if_missing=create_if_missing, label="VS Code")

    # Build the minimal config
    new_config: dict[str, Any] = {
        "servers": _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    }

    # If already configured exactly as desired and not forcing, no-op
    maybe_skip = _skip_if_already_configured(
        target_path,
        url=url,
        api_key=api_key,
        name=server_name,
        force=force,
        dry_run=dry_run,
        label="VS Code",
    )
    if maybe_skip is not None:
        return maybe_skip

    # Prepare backup if file exists
    backup_path = _backup_if_exists(target_path, dry_run=dry_run)

    # Write new config
    return _write_config(
        target_path,
        new_config=new_config,
        backup_path=backup_path,
        dry_run=dry_run,
        label="VS Code",
    )


def _merge_preserving_non_mcp(
    existing_obj: dict[str, Any], new_mcp: dict[str, Any]
) -> dict[str, Any]:
    merged = dict(existing_obj)
    merged.pop("servers", None)
    merged["mcpServers"] = new_mcp
    return merged


def export_to_claude_code(
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> ExportResult:
    """Export for Claude Code.

    - If target is a general settings file, preserve non-MCP keys and replace MCP.
    - Otherwise, write minimal MCP-only object.
    """

    _require_supported_os()
    target_path = _resolve_claude_code_target()

    is_existing = target_path.exists()
    if is_existing:
        current = _read_json_or_error(target_path)
        maybe_skip = _skip_if_already_configured(
            target_path,
            url=url,
            api_key=api_key,
            name=server_name,
            force=force,
            dry_run=dry_run,
            label="Claude Code",
        )
        if maybe_skip is not None:
            return maybe_skip
    else:
        if not create_if_missing:
            raise ExportError(
                f"Claude Code config not found at {target_path}. Refusing to create without confirmation."
            )
        current = {}

    new_mcp = _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    if is_existing and current:
        new_config = _merge_preserving_non_mcp(current, new_mcp)
    else:
        new_config = {"mcpServers": new_mcp}

    backup_path = _backup_if_exists(target_path, dry_run=dry_run)
    return _write_config(
        target_path,
        new_config=new_config,
        backup_path=backup_path,
        dry_run=dry_run,
        label="Claude Code",
    )


def export_to_claude_desktop(
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> ExportResult:
    """Export for Claude Desktop.

    - Preserve non-MCP keys in existing config; otherwise write minimal MCP-only object.
    - Location matches platform-specific user-level paths.
    """

    _require_supported_os()
    target_path = _resolve_claude_desktop_target()

    is_existing = target_path.exists()
    if is_existing:
        current = _read_json_or_error(target_path)
        maybe_skip = _skip_if_already_configured(
            target_path,
            url=url,
            api_key=api_key,
            name=server_name,
            force=force,
            dry_run=dry_run,
            label="Claude Desktop",
        )
        if maybe_skip is not None:
            return maybe_skip
    else:
        if not create_if_missing:
            raise ExportError(
                f"Claude Desktop config not found at {target_path}. Refusing to create without confirmation."
            )
        current = {}

    new_mcp = _build_open_edison_server(name=server_name, url=url, api_key=api_key)
    if is_existing and current:
        new_config = _merge_preserving_non_mcp(current, new_mcp)
    else:
        new_config = {"mcpServers": new_mcp}

    backup_path = _backup_if_exists(target_path, dry_run=dry_run)
    return _write_config(
        target_path,
        new_config=new_config,
        backup_path=backup_path,
        dry_run=dry_run,
        label="Claude Desktop",
    )


def open_claude_desktop_extension_dxt() -> Path | None:
    """Best-effort: locate and open the bundled .dxt file for install.

    Returns the path if found, otherwise None. Does not raise on failure.
    """
    cands = _find_dxt_candidates()
    if not cands:
        log.info("No .dxt found in expected locations; skipping auto-open")
        return None
    dxt = cands[0]
    log.info("Opening Claude Desktop extension: {}", dxt)
    _open_with_os(dxt)
    return dxt
