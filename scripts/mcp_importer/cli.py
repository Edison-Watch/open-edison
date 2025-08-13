# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from loguru import logger as log

# Ensure import of src config (place src on sys.path before import)
THIS_FILE = Path(__file__).resolve()
REPO_ROOT = THIS_FILE.parents[2]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import Config, get_config_dir  # type: ignore  # noqa: E402

from .importers import IMPORTERS  # noqa: E402
from .merge import MergePolicy, merge_servers  # noqa: E402


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Import MCP servers from other tools into Open Edison config.json"
    )
    p.add_argument(
        "--source", choices=list(IMPORTERS.keys()) + ["interactive"], default="interactive"
    )
    p.add_argument(
        "--project-dir",
        type=Path,
        help="When --source=cursor, path to the project containing .cursor/mcp.json",
    )
    p.add_argument(
        "--config-dir",
        type=Path,
        help="Directory containing target config.json (default: OPEN_EDISON_CONFIG_DIR or repo root)",
    )
    p.add_argument(
        "--merge",
        choices=[MergePolicy.SKIP, MergePolicy.OVERWRITE, MergePolicy.RENAME],
        default=MergePolicy.SKIP,
    )
    p.add_argument(
        "--enable-imported", action="store_true", help="Enable imported servers (default: disabled)"
    )
    p.add_argument(
        "--dry-run", action="store_true", help="Show changes without writing to config.json"
    )
    return p


def prompt_source_choice() -> str:
    print("Select source to import from:")
    options = list(IMPORTERS.keys())
    for idx, name in enumerate(options, start=1):
        print(f"  {idx}. {name}")
    while True:
        choice = input("Enter number: ").strip()
        if choice.isdigit():
            num = int(choice)
            if 1 <= num <= len(options):
                return options[num - 1]
        print("Invalid selection. Try again.")


def run_cli(argv: list[str] | None = None) -> int:  # noqa: C901
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    source: str = prompt_source_choice() if args.source == "interactive" else args.source

    importer = IMPORTERS.get(source)
    if not importer:
        print(f"Unsupported source: {source}", file=sys.stderr)
        return 2

    # Resolve target config path
    target_dir: Path = args.config_dir or get_config_dir()
    target_path = target_dir / "config.json"

    # Load existing config (auto-creates default if missing via Config.load)
    config_obj: Any = Config.load(target_dir)

    # Import
    try:
        if source == "cursor":
            if not args.project_dir:
                print("--project-dir is required for --source=cursor", file=sys.stderr)
                return 2
            imported_servers = importer(args.project_dir)  # type: ignore[arg-type]
        else:
            imported_servers = importer()  # type: ignore[misc]
    except Exception as e:
        log.error("{}", e)
        return 1

    if not imported_servers:
        log.warning("No servers found to import from source '{}'", source)
        return 0

    # Merge
    merged = merge_servers(
        existing=config_obj.mcp_servers,
        imported=imported_servers,
        policy=args.merge,
        enable_imported=bool(args.enable_imported),
    )

    existing_names: set[str] = {str(getattr(s, "name", "")) for s in config_obj.mcp_servers}
    merged_names: set[str] = {str(getattr(s, "name", "")) for s in merged}
    added = merged_names - existing_names
    replaced: set[str] = set()
    if args.merge == MergePolicy.OVERWRITE:
        replaced = existing_names & {s.name for s in imported_servers}

    log.info("Imported {} server(s) from '{}'", len(imported_servers), source)
    if added:
        log.info("Added: {}", ", ".join(sorted(added)))
    if replaced:
        log.info("Overwrote: {}", ", ".join(sorted(replaced)))

    if args.dry_run:
        log.info("Dry-run enabled; not writing changes to {}", target_path)
        return 0

    config_obj.mcp_servers = merged
    config_obj.save(target_dir)
    log.info("Configuration updated: {}", target_path)
    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
