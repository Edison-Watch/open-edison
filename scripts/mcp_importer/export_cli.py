from __future__ import annotations

import argparse
from pathlib import Path

from loguru import logger as log

from .exporters import ExportError, export_to_cursor, export_to_vscode


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
    p.add_argument("--target", choices=["cursor", "vscode"], default="cursor")
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


def run_cli(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.target == "cursor":
        # Determine if file exists to decide on confirmation
        from .paths import find_cursor_user_file

        files = find_cursor_user_file()
        target_path: Path
        if files:
            target_path = files[0]
        else:
            target_path = (Path.home() / ".cursor" / "mcp.json").resolve()

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
    elif args.target == "vscode":
        # Determine if file exists to decide on confirmation
        from .paths import find_vscode_user_mcp_file, is_macos

        files = find_vscode_user_mcp_file()
        if files:
            target_path = files[0]
        else:
            if is_macos():
                target_path = (
                    Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
                ).resolve()
            else:
                target_path = (Path.home() / ".config" / "Code" / "User" / "mcp.json").resolve()

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
    else:
        log.error("Unsupported target: {}", args.target)
        return 2

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


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
