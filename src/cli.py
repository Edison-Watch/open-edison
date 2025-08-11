"""
CLI entrypoint for Open Edison.

Provides `open-edison` executable when installed via pip/uvx/pipx.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess as _subprocess
from contextlib import suppress
from pathlib import Path
from typing import Any, NoReturn

from loguru import logger as _log  # type: ignore[reportMissingImports]

log: Any = _log

from .config import Config, get_config_dir
from .server import OpenEdisonProxy


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
    # Website runs from packaged assets by default; no extra website flags

    subparsers = parser.add_subparsers(dest="command", required=False)

    # No website subcommand; dashboard served from packaged assets

    return parser.parse_args(argv)


def _spawn_frontend_dev(
    port: int,
    override_dir: Path | None = None,
    config_dir: Path | None = None,
) -> tuple[int, _subprocess.Popen[bytes] | None]:
    """Try to start the frontend dev server by running `npm run dev`.

    Search order for working directory:
    1) Packaged project path: <pkg_root>/frontend
    2) Current working directory (if it contains a package.json)
    """
    candidates: list[Path] = []
    # Prefer packaged static assets; if present, the backend serves /dashboard
    static_candidates = [
        Path(__file__).parent / "frontend_dist",  # inside package dir
        Path(__file__).parent.parent / "frontend_dist",  # site-packages root
    ]
    static_dir = next((p for p in static_candidates if p.exists() and p.is_dir()), None)
    if static_dir is not None:
        log.info(
            f"Packaged dashboard detected at {static_dir}. It will be served at /dashboard by the API server."
        )
        # No separate website process needed. Return sentinel port (-1) so caller knows not to warn.
        return (-1, None)
    pkg_frontend_candidates = [
        Path(__file__).parent / "frontend",  # inside package dir
        Path(__file__).parent.parent / "frontend",  # site-packages root
    ]
    if override_dir is not None:
        candidates.append(override_dir)
    for pf in pkg_frontend_candidates:
        if pf.exists():
            candidates.append(pf)
    if config_dir is not None and (config_dir / "package.json").exists():
        candidates.append(config_dir)
    cwd_pkg = Path.cwd()
    if (cwd_pkg / "package.json").exists():
        candidates.append(cwd_pkg)

    if not candidates:
        log.warning(
            "No frontend directory found (no packaged frontend and no package.json in CWD). Skipping website."
        )
        return (port, None)

    for candidate in candidates:
        try:
            # If no package.json but directory exists, try a basic npm i per user request
            if not (candidate / "package.json").exists():
                log.info(f"No package.json in {candidate}. Running 'npm i' as best effort...")
                _ = _subprocess.call(["npm", "i"], cwd=str(candidate))

            # Install deps if needed
            if (
                not (candidate / "node_modules").exists()
                and (candidate / "package-lock.json").exists()
            ):
                log.info(f"Installing frontend dependencies with npm ci in {candidate}...")
                r_install = _subprocess.call(["npm", "ci"], cwd=str(candidate))
                if r_install != 0:
                    log.error("Failed to install frontend dependencies")
                    continue

            log.info(f"Starting frontend dev server in {candidate} on port {port}...")
            cmd_default = ["npm", "run", "dev", "--", "--port", str(port)]
            proc = _subprocess.Popen(cmd_default, cwd=str(candidate))
            return (port, proc)
        except FileNotFoundError:
            log.error("npm not found. Please install Node.js to run the website dev server.")
            return (port, None)

    # If all candidates failed
    return (port, None)


async def _run_server(args: Any) -> None:
    # Resolve config dir and expose via env for the rest of the app
    config_dir_arg = getattr(args, "config_dir", None)
    if config_dir_arg is not None:
        os.environ["OPEN_EDISON_CONFIG_DIR"] = str(Path(config_dir_arg).expanduser().resolve())
    config_dir = get_config_dir()

    # Load config after setting env override
    cfg = Config.load()

    host = getattr(args, "host", None) or cfg.server.host
    port = getattr(args, "port", None) or cfg.server.port

    log.info(f"Using config directory: {config_dir}")
    proxy = OpenEdisonProxy(host=host, port=port)

    # Website served from packaged assets by default; still detect and log
    frontend_proc = None
    used_port, frontend_proc = _spawn_frontend_dev(5173, None, config_dir)
    if frontend_proc is None and used_port == -1:
        log.info("Frontend is being served from packaged assets at /dashboard")

    try:
        await proxy.start()
        _ = await asyncio.Event().wait()
    except KeyboardInterrupt:
        log.info("Received shutdown signal")
    finally:
        if frontend_proc is not None:
            with suppress(Exception):
                frontend_proc.terminate()
                _ = frontend_proc.wait(timeout=5)
            with suppress(Exception):
                frontend_proc.kill()


def _run_website(port: int, website_dir: Path | None = None) -> int:
    # Use the same spawning logic, then return 0 if started or 1 if failed
    _, proc = _spawn_frontend_dev(port, website_dir)
    return 0 if proc is not None else 1


def main(argv: list[str] | None = None) -> NoReturn:
    args = _parse_args(argv)

    if getattr(args, "command", None) == "website":
        exit_code = _run_website(port=args.port, website_dir=getattr(args, "dir", None))
        raise SystemExit(exit_code)

    # default: run server (top-level flags)
    try:
        asyncio.run(_run_server(args))
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception as exc:  # noqa: BLE001
        log.error(f"Fatal error: {exc}")
        raise SystemExit(1)
