"""
CLI entrypoint for Open Edison.
Provides the `open-edison` executable when installed via pip/uvx/pipx.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any, NoReturn

from loguru import logger as log

from src.config import Config, get_config_dir, get_config_json_path
from src.demos.trifecta import demo_config_dir, run_trifecta_demo
from src.mcp_importer.api import detect_clients, restore_client
from src.mcp_importer.cli import run_cli
from src.server import OpenEdisonProxy
from src.setup_tui.main import run_import_tui


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser: Any = argparse.ArgumentParser(
        prog="open-edison",
        description="Open Edison - Single-user MCP proxy server",
    )

    # Top-level options for default run mode
    parser.add_argument(
        "--config-dir",
        type=Path,
        help="Directory containing config.json and related files. If omitted, uses OPEN_EDISON_CONFIG_DIR or package root.",
    )
    parser.add_argument("--host", type=str, help="Server host override")
    parser.add_argument(
        "--port", type=int, help="Server port override (FastMCP on port, FastAPI on port+1)"
    )
    # For the setup wizard
    parser.add_argument(
        "--wizard-dry-run",
        action="store_true",
        help="(For the setup wizard) Show changes without writing to config.json",
    )
    parser.add_argument(
        "--wizard-skip-oauth",
        action="store_true",
        help="(For the setup wizard) Skip OAuth for remote servers (they will be omitted from import)",
    )
    parser.add_argument(
        "--wizard-force",
        action="store_true",
        help="(For the setup wizard) Force running the setup wizard even if it has already been run",
    )
    # Website runs from packaged assets by default; no extra website flags

    # Subcommands (extensible)
    subparsers = parser.add_subparsers(dest="command", required=False)

    # import-mcp: import MCP servers from other tools into config.json
    sp_import = subparsers.add_parser(
        "import-mcp",
        help="Import MCP servers from other tools (Cursor, VS Code, Claude Code)",
        description=(
            "Import MCP server configurations from other tools into Open Edison config.json.\n"
            "Use --source to choose the tool and optional flags to control merging."
        ),
    )
    sp_import.add_argument(
        "--source",
        choices=[
            "cursor",
            "vscode",
            "claude-code",
        ],
        default="cursor",
        help="Source application to import from",
    )
    sp_import.add_argument(
        "--config-dir",
        type=Path,
        help=(
            "Directory containing target config.json (default: OPEN_EDISON_CONFIG_DIR or repo root)."
        ),
    )
    sp_import.add_argument(
        "--merge",
        choices=["skip", "overwrite", "rename"],
        default="skip",
        help="Merge policy for duplicate server names",
    )
    sp_import.add_argument(
        "--enable-imported",
        action="store_true",
        help="Enable imported servers (default: disabled)",
    )
    sp_import.add_argument(
        "--dry-run",
        action="store_true",
        help="Show changes without writing to config.json",
    )
    _ = subparsers.add_parser(
        "demo-trifecta",
        help="Run the Simple Trifecta Demo setup and print the prompt",
        description=(
            "Seeds a demo secret file in /tmp, checks config hints, and prints the demo prompt."
        ),
    )

    # restore-clients: restore editor configs from backups or remove OE-only config
    sp_restore = subparsers.add_parser(
        "restore-clients",
        help="Restore backed up MCP client configs (Cursor, VS Code, Claude Code)",
        description=(
            "Detect installed clients and restore their MCP config from the most recent backup, "
            "or remove the Open Edison-only MCP entry if no backup is present."
        ),
    )
    sp_restore.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview restore operations without writing",
    )

    return parser.parse_args(argv)


async def _run_server(args: Any) -> None:
    config_dir = get_config_dir()

    # Load config after setting env override
    cfg = Config(get_config_json_path())

    host = getattr(args, "host", None) or cfg.server.host
    port = getattr(args, "port", None) or cfg.server.port

    log.info(f"Using config directory: {config_dir}")
    proxy = OpenEdisonProxy(host=host, port=port)

    try:
        await proxy.start()
    except KeyboardInterrupt:
        log.info("Received shutdown signal")


def main(argv: list[str] | None = None) -> NoReturn:  # noqa: C901
    args = _parse_args(argv)

    # Resolve config dir and expose via env for the rest of the app
    config_dir_arg = getattr(args, "config_dir", None)
    if config_dir_arg is not None:
        os.environ["OPEN_EDISON_CONFIG_DIR"] = str(Path(config_dir_arg).expanduser().resolve())

    if args.command is None:
        args.command = "run"

    if args.command == "import-mcp":
        # Forward only the subcommand args (exclude the 'import-mcp' token itself)
        if argv is None:
            argv = sys.argv[1:]
        raw_args = list(argv)
        try:
            subcmd_index = raw_args.index("import-mcp")
            sub_argv = raw_args[subcmd_index + 1 :]
        except ValueError:
            sub_argv = raw_args

        result_code = run_cli(sub_argv)
        raise SystemExit(result_code)
    if args.command == "demo-trifecta":
        run_trifecta_demo()
        with demo_config_dir() as demo_dir:
            os.environ["OPEN_EDISON_CONFIG_DIR"] = str(demo_dir)
            asyncio.run(_run_server(args))
        raise SystemExit(0)

    if args.command == "restore-clients":
        # Detect clients and prompt user per client
        available = sorted(detect_clients(), key=lambda c: c.value)
        if not available:
            log.info("No supported MCP clients detected")
            raise SystemExit(0)
        from questionary import confirm

        for client in available:
            if not confirm(
                f"Restore original MCP config for {client.value}? (removes Open Edison)",
                default=True,
            ).ask():
                continue
            try:
                res = restore_client(client, dry_run=getattr(args, "dry_run", False))
                if getattr(args, "dry_run", False):
                    log.info("[dry-run] {}: would restore at {}", client.value, res.target_path)
                else:
                    if res.restored_from_backup is not None:
                        log.info(
                            "Restored {} from backup {}", client.value, res.restored_from_backup
                        )
                    elif res.removed_open_edison_only:
                        log.info(
                            "Removed Open Edison-only entry from {} at {}",
                            client.value,
                            res.target_path,
                        )
                    else:
                        log.info("No restore action taken for {}", client.value)
            except Exception as e:
                log.error(f"Restore failed for {client.value}: {e}")
                raise SystemExit(1) from e
        raise SystemExit(0)

    # Run import tui if necessary
    tui_success = run_import_tui(args, force=args.wizard_force)
    if not tui_success:
        raise SystemExit(1)

    try:
        asyncio.run(_run_server(args))
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(0) from None
    except Exception as exc:  # noqa: BLE001
        log.error(f"Fatal error: {exc}")
        raise SystemExit(1) from exc
