import sys

from src.mcp_importer.cli import run_cli as import_run_cli
from src.mcp_importer.export_cli import run_cli as export_run_cli


def main() -> int:
    # Usage:
    #   python -m mcp_importer            -> import CLI
    #   python -m mcp_importer export ... -> export CLI
    if len(sys.argv) > 1 and sys.argv[1] == "export":
        return export_run_cli(sys.argv[2:])
    return import_run_cli(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
