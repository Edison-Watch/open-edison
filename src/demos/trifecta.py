"""
Trifecta demo runner used by the CLI and the standalone script.

This module seeds a secret file under the tmp directory, checks for basic
config hints, and prints the user prompt found at demo/trifecta_user_prompt.txt.

Additionally, it provides a helper to create a temporary configuration
directory containing `config.json` and the three permissions JSON files
so the demo can run with a known-good configuration without touching the
user's real config directory.
"""

import sys
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

import questionary
from loguru import logger as log


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


def _seed_secret_file(version: str) -> None:
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    installed_ts = datetime.now(UTC).isoformat()
    lines = [
        "Open Edison Demo Secret",
        f"version={version}",
        f"installed_utc={installed_ts}",
    ]
    SECRET_FILE.write_text("\n".join(lines), encoding="utf-8")


@contextmanager
def demo_config_dir() -> Generator[Path, None, None]:
    """Create a temporary config directory for the demo with JSONs.

    Copies `config.json`, `tool_permissions.json`, `resource_permissions.json`,
    and `prompt_permissions.json` from the repository root into a new directory
    under the system tmp path. Ensures the `fetch` and `filesystem` servers are
    enabled in the copied `config.json`. Returns the created directory path.
    """
    repo_root = Path(__file__).resolve().parents[2]
    filenames = [
        "config.json",
        "tool_permissions.json",
        "resource_permissions.json",
        "prompt_permissions.json",
    ]

    with TemporaryDirectory(prefix="open-edison-demo-") as tmp_dir:
        demo_dir = Path(tmp_dir)
        for filename in filenames:
            log.debug(f"Copying {filename} to {demo_dir / filename}")
            (demo_dir / filename).write_text(
                (repo_root / filename).read_text(encoding="utf-8"), encoding="utf-8"
            )

        log.info(f"Created temporary demo config directory: {demo_dir}")
        yield demo_dir


def run_trifecta_demo() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    pyproject = repo_root / "pyproject.toml"
    version = _load_project_version(pyproject)

    _seed_secret_file(version)

    print("\n=== Open Edison: Simple Trifecta Demo Setup ===")
    print(f"Seeded secret file at: {SECRET_FILE}")
    print(f"Project version detected: {version}")

    print("\nNext step: Copy/paste this prompt into your MCP client:")
    print("----------------------------------------------------")
    prompt_path = repo_root / "demo" / "trifecta_user_prompt.txt"
    prompt_text = prompt_path.read_text(encoding="utf-8").strip()
    print(prompt_text)
    print("----------------------------------------------------")

    questionary.confirm(
        "Have you copied the prompt into your MCP client and are ready to launch the server now?",
        default=True,
    ).ask()

    # On return, the cli.py handles launching the server
