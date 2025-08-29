#!/usr/bin/env python3
import argparse
import re
import subprocess
import sys
from pathlib import Path


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def bump_version(pyproject: Path, part: str) -> str:
    text = read_text(pyproject)
    pattern = re.compile(
        r'^(version\s*=\s*")(?P<maj>\d+)\.(?P<min>\d+)\.(?P<pat>\d+)("\s*)$',
        re.MULTILINE,
    )
    m = pattern.search(text)
    if not m:
        print("Version not found in pyproject.toml", file=sys.stderr)
        raise SystemExit(1)

    maj = int(m.group("maj"))
    min_ = int(m.group("min"))
    pat = int(m.group("pat"))

    part = part.lower()
    if part == "major":
        maj += 1
        min_ = 0
        pat = 0
    elif part == "minor":
        min_ += 1
        pat = 0
    else:
        pat += 1

    # Use explicit group references to avoid \1N ambiguity
    new_text = pattern.sub(rf"\g<1>{maj}.{min_}.{pat}\g<5>", text, count=1)
    write_text(pyproject, new_text)
    return f"{maj}.{min_}.{pat}"


def git_commit(pyproject: Path, new_version: str, amend: bool) -> None:
    # Stage and commit the version bump
    subprocess.run(["git", "add", str(pyproject)], check=True)
    # Check if there is at least one commit to allow amend
    has_head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], capture_output=True)
    if amend and has_head.returncode == 0:
        subprocess.run(["git", "commit", "--amend", "--no-edit"], check=True)
    else:
        subprocess.run(
            ["git", "commit", "-m", f"chore(release): bump version to {new_version}"], check=True
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Bump version in pyproject.toml")
    parser.add_argument("--part", choices=["patch", "minor", "major"], default="patch")
    parser.add_argument("--file", default="pyproject.toml")
    commit_group = parser.add_mutually_exclusive_group()
    commit_group.add_argument(
        "--commit", dest="commit", action="store_true", help="commit the bump (default)"
    )
    commit_group.add_argument(
        "--no-commit", dest="commit", action="store_false", help="do not create a commit"
    )
    parser.set_defaults(commit=True)
    parser.add_argument(
        "--amend",
        action="store_true",
        help="when committing, amend the last commit instead of creating a new one",
    )
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    new_version = bump_version(path, args.part)
    if args.commit:
        try:
            git_commit(path, new_version, amend=args.amend)
            print(f"Bumped version to: {new_version} (committed)")
        except subprocess.CalledProcessError as e:
            print(f"Bumped version to: {new_version}, but failed to commit: {e}", file=sys.stderr)
            return e.returncode or 1
    else:
        print(f"Bumped version to: {new_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
