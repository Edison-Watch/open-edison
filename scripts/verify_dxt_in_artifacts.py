from __future__ import annotations

import sys
import tarfile
import zipfile
from pathlib import Path


def main() -> int:
    dist_dir = Path("dist")
    whls = sorted(dist_dir.glob("*.whl"))
    sdists = sorted(dist_dir.glob("*.tar.gz"))

    if not whls or not sdists:
        print("No artifacts found in dist/", file=sys.stderr)
        return 1

    missing = 0

    for whl in whls:
        with zipfile.ZipFile(whl) as z:
            names = z.namelist()
            ok = any(n.endswith("desktop_ext/open-edison-connector.dxt") for n in names)
            if not ok:
                print(f"Wheel missing DXT: {whl}", file=sys.stderr)
                missing += 1

    for sdist in sdists:
        with tarfile.open(sdist) as t:
            names = t.getnames()
            ok = any(n.endswith("desktop_ext/open-edison-connector.dxt") for n in names)
            if not ok:
                print(f"SDist missing DXT: {sdist}", file=sys.stderr)
                missing += 1

    if missing:
        return 2

    print("DXT present in all artifacts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
