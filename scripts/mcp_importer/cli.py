# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
import argparse
import sys
from pathlib import Path

from loguru import logger as log

from src.config import Config, get_config_dir

from .importers import IMPORTERS
from .merge import MergePolicy, merge_servers

## Ensure import of src config (place src on sys.path before import)
# THIS_FILE = Path(__file__).resolve()
# REPO_ROOT = THIS_FILE.parents[2]
# SRC_DIR = REPO_ROOT / "src"
# if str(SRC_DIR) not in sys.path:
#    sys.path.insert(0, str(SRC_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Import MCP servers from other tools into Open Edison config.json"
    )
    p.add_argument(
        "--source",
        choices=["cursor", "vscode", "claude-code", "interactive"],
        default="interactive",
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
    # TODO check this works as we want it to
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
    config_obj: Config = Config(target_dir)

    # Import
    imported_servers = importer()

    if not imported_servers:
        log.warning("No servers found to import from source '{}'", source)
        return 0

    # Merge
    merged = merge_servers(
        existing=config_obj.mcp_servers,
        imported=imported_servers,
        policy=args.merge,
    )

    existing_names: set[str] = {str(getattr(s, "name", "")) for s in config_obj.mcp_servers}
    merged_names: set[str] = {str(getattr(s, "name", "")) for s in merged}
    added = merged_names - existing_names
    replaced: set[str] = set()
    if args.merge == MergePolicy.OVERWRITE:
        replaced = existing_names & {s.name for s in imported_servers}

    log.info("Imported {} server(s) from '{}'", len(imported_servers), source)
    try:
        names_preview = ", ".join(sorted(getattr(s, "name", "") for s in imported_servers))
        if names_preview:
            log.info("Detected servers: {}", names_preview)
    except Exception:
        pass
    if added:
        log.info("Added: {}", ", ".join(sorted(added)))
    if replaced:
        log.info("Overwrote: {}", ", ".join(sorted(replaced)))

    if args.dry_run:
        log.info("Dry-run enabled; not writing changes to {}", target_path)
        log.debug("Merged servers: {}", merged)
        return 0

    config_obj.mcp_servers = merged
    config_obj.save(target_path)
    log.info("Configuration updated: {}", target_path)
    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
