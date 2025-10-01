"""
CLI entrypoint for Open Edison.
Provides the `open-edison` executable when installed via pip/uvx/pipx.
"""

import argparse
import asyncio
import os
from pathlib import Path
from typing import Any, NoReturn

from loguru import logger as log

from src.config import Config, get_config_dir, get_config_json_path
from src.server import OpenEdisonProxy


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

    parser.add_argument(
        "--get-config-dir",
        action="store_true",
        help="Print the resolved Open Edison configuration directory and exit.",
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


def main(argv: list[str] | None = None) -> NoReturn:
    args = _parse_args(argv)

    # Resolve config dir and expose via env for the rest of the app
    config_dir_arg = getattr(args, "config_dir", None)
    if config_dir_arg is not None:
        os.environ["OPEN_EDISON_CONFIG_DIR"] = str(Path(config_dir_arg).expanduser().resolve())

    # Handle query-only mode to get the resolved config directory
    if getattr(args, "get_config_dir", False):
        # Print only the directory path, no extra output
        print(get_config_dir())
        raise SystemExit(0)

    try:
        asyncio.run(_run_server(args))
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(0) from None
    except Exception as exc:  # noqa: BLE001
        log.error(f"Fatal error: {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
