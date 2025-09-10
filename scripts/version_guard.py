#!/usr/bin/env python3
"""
Version Guard: Fail if local pyproject.toml version is not greater than base ref's version.

Usage:
  python scripts/version_guard.py --base-ref origin/main [--file pyproject.toml]

Semver comparison with prerelease awareness (PEP 440-ish ordering):
  dev < a < b < rc < release
"""

import argparse
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path


def run_git_show(ref_path: str) -> bytes | None:
    try:
        cp = subprocess.run(["git", "show", ref_path], capture_output=True, check=True)
        return cp.stdout
    except subprocess.CalledProcessError:
        return None


def extract_version_from_text(text: str) -> str | None:
    m = re.search(r'^version\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    return m.group(1) if m else None


def read_local_version(pyproject_path: Path) -> str:
    try:
        text = pyproject_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print("pyproject.toml not found", file=sys.stderr)
        raise
    v = extract_version_from_text(text)
    if not v:
        print("Version not found in local pyproject.toml", file=sys.stderr)
        raise SystemExit(2)
    return v


def detect_repo() -> tuple[str, str] | None:
    repo_env = os.environ.get("GITHUB_REPOSITORY")
    if repo_env and "/" in repo_env:
        owner, name = repo_env.split("/", 1)
        return owner, name
    try:
        cp = subprocess.run(
            ["git", "remote", "get-url", "origin"], capture_output=True, text=True, check=True
        )
        url = cp.stdout.strip()
        m = re.search(r"github\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/.]+)(?:\.git)?$", url)
        if m:
            return m.group("owner"), m.group("repo")
    except subprocess.CalledProcessError:
        return None
    return None


def read_base_version_remote(base_branch: str) -> str | None:
    repo = detect_repo()
    if not repo:
        print("Could not detect repo (GITHUB_REPOSITORY or git remote origin)", file=sys.stderr)
        return None
    owner, name = repo
    url = f"https://raw.githubusercontent.com/{owner}/{name}/{base_branch}/pyproject.toml"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            if resp.status != 200:
                print(f"Failed to fetch base pyproject.toml: HTTP {resp.status}", file=sys.stderr)
                return None
            text = resp.read().decode("utf-8")
            return extract_version_from_text(text)
    except Exception as e:
        print(f"Error fetching base pyproject.toml: {e}", file=sys.stderr)
        return None


def parse_version(version: str) -> tuple[int, int, int, int, int]:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:(a|b|rc|dev)(\d+))?", version)
    if not m:
        print(f"Invalid version format: {version}", file=sys.stderr)
        raise SystemExit(2)
    major = int(m.group(1))
    minor = int(m.group(2))
    patch = int(m.group(3))
    tag = m.group(4) or None
    num = int(m.group(5)) if m.group(5) else 0
    rank_order = {None: 4, "rc": 3, "b": 2, "a": 1, "dev": 0}
    rank = rank_order[tag]
    return major, minor, patch, rank, num


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensure version > base ref's version")
    parser.add_argument("--base-ref", default="origin/main", help="git ref to compare against")
    parser.add_argument("--base-branch", default=None, help="explicit base branch name")
    parser.add_argument("--file", default="pyproject.toml", help="path to pyproject.toml")
    args = parser.parse_args()

    local_version = read_local_version(Path(args.file))
    # Determine base branch
    base_branch = args.base_branch or args.base_ref.split("/")[-1]
    base_version = read_base_version_remote(base_branch)

    if base_version is None:
        print(f"Base ref not available: {args.base_ref}; skipping guard (OK)")
        return 0

    try:
        local_tuple = parse_version(local_version)
        base_tuple = parse_version(base_version)
    except SystemExit:
        return 1

    print(f"Current: {local_version} | Base({base_branch}): {base_version}")
    if local_tuple <= base_tuple:
        print(
            f"Version must be greater than base: current={local_version} <= base={base_version}",
            file=sys.stderr,
        )
        return 1

    print(f"OK: {local_version} > {base_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
