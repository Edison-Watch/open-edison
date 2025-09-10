"""
Trifecta demo runner used by the CLI and the standalone script.

This module seeds a secret file under the tmp directory, checks for basic
config hints, and prints the user prompt found at demo/trifecta_user_prompt.txt.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _get_tmp_root() -> Path:
    if sys.platform == "darwin":
        return Path("/private/tmp")
    return Path("/tmp")


TMP_ROOT = _get_tmp_root()
SECRET_DIR = TMP_ROOT / "open-edison"
SECRET_FILE = SECRET_DIR / "mysecretdetails.txt"


def _load_project_version(pyproject_path: Path) -> str:
    try:
        import tomllib

        with pyproject_path.open("rb") as f:
            data = tomllib.load(f)
        project = data.get("project", {})
        return str(project.get("version", "unknown"))
    except Exception:
        return "unknown"


def _read_runtime_config(config_path: Path) -> dict[str, Any] | None:
    try:
        with config_path.open("r") as f:
            return json.load(f)
    except Exception:
        return None


def _is_server_enabled(config: dict[str, Any] | None, name: str) -> bool:
    try:
        if not config:
            return False
        for srv in config.get("mcp_servers", []):
            if srv.get("name") == name and bool(srv.get("enabled", False)):
                return True
        return False
    except Exception:
        return False


def _seed_secret_file(version: str) -> None:
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    installed_ts = datetime.now(UTC).isoformat()
    lines = [
        "Open Edison Demo Secret",
        f"version={version}",
        f"installed_utc={installed_ts}",
    ]
    SECRET_FILE.write_text("\n".join(lines), encoding="utf-8")


def run_trifecta_demo() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    pyproject = repo_root / "pyproject.toml"
    default_config = repo_root / "config.json"
    dev_config = repo_root / "dev_config_dir" / "config.json"

    version = _load_project_version(pyproject)

    _seed_secret_file(version)

    config_used: Path | None = None
    cfg = None
    for candidate in (dev_config, default_config):
        if candidate.exists():
            cfg = _read_runtime_config(candidate)
            config_used = candidate
            break

    fetch_ok = _is_server_enabled(cfg, "fetch")
    filesystem_ok = _is_server_enabled(cfg, "filesystem")

    print("\n=== Open Edison: Simple Trifecta Demo Setup ===")
    print(f"Seeded secret file at: {SECRET_FILE}")
    print(f"Project version detected: {version}")
    if config_used:
        print(f"Checked config: {config_used}")
    print("")

    if not fetch_ok:
        print("[hint] The 'fetch' server is not enabled in the checked config.")
        print(
            "       The demo fetches a public file (no auth). Ensure the Open Edison MCP 'fetch' server is enabled."
        )

    if not filesystem_ok:
        print("[hint] The 'filesystem' server is not enabled in the checked config.")
        print("       The demo reads /tmp/open-edison and writes to /tmp.")

    print("\nNext step: Copy/paste this prompt into your MCP client:")
    print("----------------------------------------------------")
    prompt_path = repo_root / "demo" / "trifecta_user_prompt.txt"
    prompt_text = prompt_path.read_text(encoding="utf-8").strip()
    print(prompt_text)
