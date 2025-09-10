"""
CLI entrypoint for Open Edison.
Provides the `open-edison` executable when installed via pip/uvx/pipx.
"""

import argparse
import asyncio
import os
from pathlib import Path
from typing import Any, NoReturn

from loguru import logger as _log  # type: ignore[reportMissingImports]

from src.config import Config, get_config_dir, get_config_json_path
from src.mcp_importer.cli import run_cli
from src.server import OpenEdisonProxy
from src.setup_tui.main import run_import_tui

log: Any = _log


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
        result_code = run_cli(argv)
        raise SystemExit(result_code)

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
