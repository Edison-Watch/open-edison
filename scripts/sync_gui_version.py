#!/usr/bin/env python3
"""
Sync version from pyproject.toml to gui/package.json
"""

import json
import re
import sys
from pathlib import Path


def sync_version():
    # Read version from pyproject.toml
    pyproject_path = Path("pyproject.toml")
    if not pyproject_path.exists():
        print("❌ pyproject.toml not found")
        sys.exit(1)

    with open(pyproject_path) as f:
        content = f.read()

    version_match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not version_match:
        print("❌ Could not find version in pyproject.toml")
        sys.exit(1)

    version = version_match.group(1)

    # Update gui/package.json
    package_json_path = Path("gui/package.json")
    if not package_json_path.exists():
        print("❌ gui/package.json not found")
        sys.exit(1)

    with open(package_json_path) as f:
        pkg = json.load(f)

    old_version = pkg.get("version", "unknown")
    pkg["version"] = version

    with open(package_json_path, "w") as f:
        json.dump(pkg, f, indent=2)

    print(f"✅ Updated gui/package.json version from {old_version} to {version}")


if __name__ == "__main__":
    sync_version()
