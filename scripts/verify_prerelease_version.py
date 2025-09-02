#!/usr/bin/env python3
"""Verify that the project version in pyproject.toml is a pre-release.

Accepts PEP 440-style pre-release suffixes: aN, bN, rcN, devN.
Exits non-zero if not a pre-release.
"""

import re
import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject = repo_root / "pyproject.toml"

    try:
        text = pyproject.read_text(encoding="utf-8")
    except FileNotFoundError:
        print("pyproject.toml not found", file=sys.stderr)
        return 1

    m = re.search(r'^version\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    if not m:
        print("Version not found in pyproject.toml", file=sys.stderr)
        return 1

    version = m.group(1)
    if not re.search(r"(a|b|rc|dev)\d*$", version):
        print(
            f"Version {version} is not a pre-release (missing aN/bN/rcN/devN).",
            file=sys.stderr,
        )
        return 2

    print(f"Detected pre-release version: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
