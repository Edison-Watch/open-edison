import argparse
from pathlib import Path

from loguru import logger as log

from .exporters import ExportError, export_to_claude_code, export_to_cursor, export_to_vscode
from .paths import (
    detect_claude_code_config_path,
    detect_cursor_config_path,
    detect_vscode_config_path,
    get_default_claude_code_config_path,
    get_default_cursor_config_path,
    get_default_vscode_config_path,
)


def _prompt_yes_no(message: str, *, default_no: bool = True) -> bool:
    suffix = "[y/N]" if default_no else "[Y/n]"
    while True:
        resp = input(f"{message} {suffix} ").strip().lower()
        if resp == "y" or resp == "yes":
            return True
        if resp == "n" or resp == "no":
            return False
        if resp == "" and default_no:
            return False
        if resp == "" and not default_no:
            return True


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Export editor MCP config to use Open Edison (Cursor support)",
    )
    p.add_argument("--target", choices=["cursor", "vscode", "claude-code"], default="cursor")
    p.add_argument("--dry-run", action="store_true", help="Show actions without writing")
    p.add_argument("--force", action="store_true", help="Rewrite even if already configured")
    p.add_argument(
        "--yes",
        action="store_true",
        help="Automatic yes to prompts (create missing files without confirmation)",
    )
    p.add_argument("--url", default="http://localhost:3000/mcp/", help="MCP URL")
    p.add_argument(
        "--api-key",
        default="dev-api-key-change-me",
        help="API key for Authorization header",
    )
    p.add_argument("--name", default="open-edison", help="Name of the server entry")
    return p


def _handle_cursor(args: argparse.Namespace) -> int:
    detected = detect_cursor_config_path()
    target_path: Path = detected if detected else get_default_cursor_config_path()

    create_if_missing = False
    if not target_path.exists():
        if args.yes:
            create_if_missing = True
        else:
            confirmed = _prompt_yes_no(
                f"Cursor config not found at {target_path}. Create it?", default_no=False
            )
            if not confirmed:
                log.info("Aborted: user declined to create missing file")
                return 0
            create_if_missing = True

    try:
        result = export_to_cursor(
            url=args.url,
            api_key=args.api_key,
            server_name=args.name,
            dry_run=args.dry_run,
            force=args.force,
            create_if_missing=create_if_missing,
        )
    except ExportError as e:
        log.error(str(e))
        return 1

    if result.dry_run:
        log.info("Dry-run complete. No changes written.")
        return 0

    if result.wrote_changes:
        if result.backup_path is not None:
            log.info("Backup created at {}", result.backup_path)
        log.info("Updated {}", result.target_path)
    else:
        log.info("No changes were necessary.")
    return 0


def _handle_vscode(args: argparse.Namespace) -> int:
    detected = detect_vscode_config_path()
    target_path: Path = detected if detected else get_default_vscode_config_path()

    create_if_missing = False
    if not target_path.exists():
        if args.yes:
            create_if_missing = True
        else:
            confirmed = _prompt_yes_no(
                f"VS Code MCP config not found at {target_path}. Create it?", default_no=False
            )
            if not confirmed:
                log.info("Aborted: user declined to create missing file")
                return 0
            create_if_missing = True

    try:
        result = export_to_vscode(
            url=args.url,
            api_key=args.api_key,
            server_name=args.name,
            dry_run=args.dry_run,
            force=args.force,
            create_if_missing=create_if_missing,
        )
    except ExportError as e:
        log.error(str(e))
        return 1

    if result.dry_run:
        log.info("Dry-run complete. No changes written.")
        return 0

    if result.wrote_changes:
        if result.backup_path is not None:
            log.info("Backup created at {}", result.backup_path)
        log.info("Updated {}", result.target_path)
    else:
        log.info("No changes were necessary.")
    return 0


def _handle_claude_code(args: argparse.Namespace) -> int:
    detected = detect_claude_code_config_path()
    target_path: Path = detected if detected else get_default_claude_code_config_path()

    create_if_missing = False
    if not target_path.exists():
        if args.yes:
            create_if_missing = True
        else:
            confirmed = _prompt_yes_no(
                f"Claude Code config not found at {target_path}. Create it?", default_no=False
            )
            if not confirmed:
                log.info("Aborted: user declined to create missing file")
                return 0
            create_if_missing = True

    try:
        result = export_to_claude_code(
            url=args.url,
            api_key=args.api_key,
            server_name=args.name,
            dry_run=args.dry_run,
            force=args.force,
            create_if_missing=create_if_missing,
        )
    except ExportError as e:
        log.error(str(e))
        return 1

    if result.dry_run:
        log.info("Dry-run complete. No changes written.")
        return 0

    if result.wrote_changes:
        if result.backup_path is not None:
            log.info("Backup created at {}", result.backup_path)
        log.info("Updated {}", result.target_path)
    else:
        log.info("No changes were necessary.")
    return 0


def run_cli(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.target == "cursor":
        return _handle_cursor(args)
    if args.target == "vscode":
        return _handle_vscode(args)
    if args.target == "claude-code":
        return _handle_claude_code(args)
    log.error("Unsupported target: {}", args.target)
    return 2


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
