#!/usr/bin/env python3
"""Mark project version as pre-release or release in pyproject.toml.

Usage:
  version_mark.py prerelease --tag rc [--commit | --no-commit] [--amend]
  version_mark.py release [--commit | --no-commit] [--amend]

Behavior:
- prerelease: adds or bumps a pre-release suffix (a|b|rc|dev). If version is
  X.Y.Z, it becomes X.Y.Z<tag>1 (default tag rc). If already X.Y.Z<tag>N, it
  becomes X.Y.Z<tag>(N+1). If tag changes, resets to 1.
- release: strips any pre-release suffix, leaving X.Y.Z.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

VERSION_PATTERN = re.compile(
    r"^(version\s*=\s*\")(?P<maj>\d+)\.(?P<min>\d+)\.(?P<pat>\d+)(?P<pre>(a|b|rc|dev)(?P<num>\d+))?(\"\s*)$",
    re.MULTILINE,
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def git_commit(pyproject: Path, new_version: str, amend: bool) -> None:
    subprocess.run(["git", "add", str(pyproject)], check=True)
    has_head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], capture_output=True)
    if amend and has_head.returncode == 0:
        subprocess.run(["git", "commit", "--amend", "--no-edit"], check=True)
    else:
        subprocess.run(
            ["git", "commit", "-m", f"chore(release): set version to {new_version}"],
            check=True,
        )


def apply_prerelease(text: str, tag: str) -> tuple[str, str]:
    m = VERSION_PATTERN.search(text)
    if not m:
        print("Version not found or not parseable in pyproject.toml", file=sys.stderr)
        raise SystemExit(1)

    maj = int(m.group("maj"))
    min_ = int(m.group("min"))
    pat = int(m.group("pat"))
    pre = m.group("pre") or ""
    num_str = m.group("num")

    if pre:
        # Existing pre-release
        m_tag = re.match(r"(a|b|rc|dev)", pre)
        current_tag = m_tag.group(0) if m_tag else ""
        current_num = int(num_str) if num_str else 0
        next_num = current_num + 1 if current_tag == tag else 1
        new_version = f"{maj}.{min_}.{pat}{tag}{next_num}"
    else:
        # No pre-release, add tag1
        new_version = f"{maj}.{min_}.{pat}{tag}1"

    # Replace keeping leading 'version = "' and trailing quote/whitespace
    new_text = VERSION_PATTERN.sub(rf"\g<1>{new_version}\g<8>", text, count=1)
    return new_text, new_version


def apply_release(text: str) -> tuple[str, str]:
    m = VERSION_PATTERN.search(text)
    if not m:
        print("Version not found or not parseable in pyproject.toml", file=sys.stderr)
        raise SystemExit(1)

    maj = int(m.group("maj"))
    min_ = int(m.group("min"))
    pat = int(m.group("pat"))
    new_version = f"{maj}.{min_}.{pat}"
    new_text = VERSION_PATTERN.sub(rf"\g<1>{new_version}\g<8>", text, count=1)
    return new_text, new_version


def main() -> int:
    parser = argparse.ArgumentParser(description="Mark version as prerelease or release")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pre = sub.add_parser("prerelease", help="add or bump a pre-release suffix")
    p_pre.add_argument("--tag", choices=["a", "b", "rc", "dev"], default="rc")
    commit_group = p_pre.add_mutually_exclusive_group()
    commit_group.add_argument("--commit", dest="commit", action="store_true")
    commit_group.add_argument("--no-commit", dest="commit", action="store_false")
    p_pre.set_defaults(commit=True)
    p_pre.add_argument("--amend", action="store_true")

    p_rel = sub.add_parser("release", help="strip any pre-release suffix")
    commit_group2 = p_rel.add_mutually_exclusive_group()
    commit_group2.add_argument("--commit", dest="commit", action="store_true")
    commit_group2.add_argument("--no-commit", dest="commit", action="store_false")
    p_rel.set_defaults(commit=True)
    p_rel.add_argument("--amend", action="store_true")

    args = parser.parse_args()

    pyproject = Path("pyproject.toml")
    if not pyproject.exists():
        print("pyproject.toml not found", file=sys.stderr)
        return 1

    text = read_text(pyproject)
    if args.cmd == "prerelease":
        new_text, new_version = apply_prerelease(text, args.tag)
    else:
        new_text, new_version = apply_release(text)

    write_text(pyproject, new_text)

    if args.commit:
        try:
            git_commit(pyproject, new_version, amend=args.amend)
            print(f"Set version to: {new_version} (committed)")
        except subprocess.CalledProcessError as e:
            print(f"Set version to: {new_version}, but failed to commit: {e}", file=sys.stderr)
            return e.returncode or 1
    else:
        print(f"Set version to: {new_version}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
