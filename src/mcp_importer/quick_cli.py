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
    parser.add_argument(
        "--source-client", type=CLIENT, help="Client to import from", required=False, default=None
    )
    args = parser.parse_args(argv)

    detected = detect_clients()
    print(f"Detected clients: {detected}")
    if args.source_client:
        client = args.source_client
        assert client in detected, f"Client {client} not detected"
    else:
        client = _pick_first(detected)
    print(f"Going to import from client: {client}")
    if client is None:
        print("No supported clients detected.")
        return 2

    servers = import_from(client)
    if not servers:
        print(f"No servers found to import from '{client.value}'.")
        return 0

    save_imported_servers(servers, dry_run=args.dry_run)
    export_edison_to(client, dry_run=args.dry_run, force=True, create_if_missing=True)
    print(f"Completed quick import/export for {client.value}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    return run_cli(argv)


if __name__ == "__main__":
    raise SystemExit(main())
