"""
CLI entrypoint for Open Edison.

Provides `open-edison` executable when installed via pip/uvx/pipx.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess as _subprocess
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any, NoReturn, cast

from loguru import logger as _log  # type: ignore[reportMissingImports]

from .config import Config, get_config_dir
from .server import OpenEdisonProxy

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
    # Website runs from packaged assets by default; no extra website flags

    # Subcommands (extensible)
    subparsers = parser.add_subparsers(dest="command", required=False)

    # import-mcp: import MCP servers from other tools into config.json
    sp_import = subparsers.add_parser(
        "import-mcp",
        help="Import MCP servers from other tools (Cursor, Windsurf, Cline, Claude Desktop, etc.)",
        description=(
            "Import MCP server configurations from other tools into Open Edison config.json.\n"
            "Use --source to choose the tool and optional flags to control merging."
        ),
    )
    sp_import.add_argument(
        "--source",
        choices=[
            "cursor",
            "windsurf",
            "cline",
            "claude-desktop",
            "vscode",
            "claude-code",
            "gemini-cli",
            "codex",
            "interactive",
        ],
        default="interactive",
        help="Source application to import from",
    )
    sp_import.add_argument(
        "--project-dir",
        type=Path,
        help="When --source=cursor, path to the project containing .cursor/mcp.json",
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


def _spawn_frontend_dev(  # noqa: C901 - pragmatic complexity for env probing
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
    # TODO check this works as we want it to
    # Resolve config dir and expose via env for the rest of the app
    config_dir_arg = getattr(args, "config_dir", None)
    if config_dir_arg is not None:
        os.environ["OPEN_EDISON_CONFIG_DIR"] = str(Path(config_dir_arg).expanduser().resolve())
    config_dir = get_config_dir()

    # Load config after setting env override
    cfg = Config(config_dir)

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


def main(argv: list[str] | None = None) -> NoReturn:  # noqa: C901
    args = _parse_args(argv)

    if getattr(args, "command", None) == "website":
        exit_code = _run_website(port=args.port, website_dir=getattr(args, "dir", None))
        raise SystemExit(exit_code)

    if getattr(args, "command", None) == "import-mcp":
        # Defer-import importer package (lives under repository scripts/)
        importer_pkg = Path(__file__).parent.parent / "scripts" / "mcp_importer"
        try:
            if str(importer_pkg) not in sys.path:
                sys.path.insert(0, str(importer_pkg))
            from mcp_importer.cli import run_cli  # type: ignore
        except Exception as imp_exc:  # noqa: BLE001
            log.error(
                "Failed to load MCP importer package from {}: {}",
                importer_pkg,
                imp_exc,
            )
            raise SystemExit(1) from imp_exc

        importer_argv: list[str] = []
        if args.source:
            importer_argv += ["--source", str(args.source)]
        if getattr(args, "project_dir", None):
            importer_argv += [
                "--project-dir",
                str(Path(args.project_dir).expanduser().resolve()),
            ]
        if getattr(args, "config_dir", None):
            importer_argv += [
                "--config-dir",
                str(Path(args.config_dir).expanduser().resolve()),
            ]
        if args.merge:
            importer_argv += ["--merge", str(args.merge)]
        if bool(getattr(args, "enable_imported", False)):
            importer_argv += ["--enable-imported"]
        if bool(getattr(args, "dry_run", False)):
            importer_argv += ["--dry-run"]

        rc_val: int = int(cast(Any, run_cli)(importer_argv))
        raise SystemExit(rc_val)

    # default: run server (top-level flags)
    try:
        asyncio.run(_run_server(args))
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(0) from None
    except Exception as exc:  # noqa: BLE001
        log.error(f"Fatal error: {exc}")
        raise SystemExit(1) from exc
