from __future__ import annotations

import argparse
from collections.abc import Iterable

from src.mcp_importer.api import (
    CLIENT,
    detect_clients,
    export_edison_to,
    import_from,
    save_imported_servers,
)


def _pick_first(iterable: Iterable[CLIENT]) -> CLIENT | None:
    for item in iterable:
        return item
    return None


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Detect a client, import its servers into Open Edison, and export Open Edison back to it."
        )
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without writing")
    parser.add_argument("--yes", action="store_true", help="Skip confirmations (no effect here)")
    args = parser.parse_args(argv)

    detected = detect_clients()
    client = _pick_first(detected)
    if client is None:
        print("No supported clients detected.")
        return 2

    servers = import_from(client)
    if not servers:
        print(f"No servers found to import from '{client.value}'.")
        return 0

    if args.dry_run:
        print(
            f"[dry-run] Would import {len(servers)} server(s) from '{client.value}' and save to config.json"
        )
        # Exercise export path safely (no writes)
        export_edison_to(client, dry_run=True, force=True, create_if_missing=True)
        print(
            f"[dry-run] Would export Open Edison to '{client.value}' (backup and replace editor MCP config)"
        )
        print("Dry-run complete.")
        return 0

    save_imported_servers(servers)
    export_edison_to(client, dry_run=False, force=True, create_if_missing=True)
    print(f"Completed quick import/export for {client.value}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    return run_cli(argv)


if __name__ == "__main__":
    raise SystemExit(main())
