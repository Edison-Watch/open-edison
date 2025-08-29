import os
import shutil
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class BuildHook(BuildHookInterface):  # type: ignore
    """Ensure packaged frontend assets exist in src/frontend_dist before build.

    Behavior:
    - If src/frontend_dist/index.html exists, do nothing.
    - Else if frontend/dist/index.html exists, copy it to src/frontend_dist/.
    - Else raise a clear error instructing to run `make build_package` first.
      We intentionally DO NOT run npm during packaging to avoid assuming it
      on build/install environments.
    """

    def initialize(self, version: str, build_data: dict) -> None:  # noqa: D401 # type: ignore
        project_root = Path(self.root)
        src_frontend_dist = project_root / "src" / "frontend_dist"
        repo_frontend_dist = project_root / "frontend" / "dist"

        # Opt-in enforcement: only enforce when OPEN_EDISON_REQUIRE_FRONTEND=1/true/yes
        enforce = os.environ.get("OPEN_EDISON_REQUIRE_FRONTEND", "").lower() in {"1", "true", "yes"}
        if not enforce:
            self.app.display_info(
                "Skipping frontend_dist enforcement (set OPEN_EDISON_REQUIRE_FRONTEND=1 to enforce)"
            )
            return

        # Fast path: already present in src/
        if (src_frontend_dist / "index.html").exists():
            self.app.display_info("frontend_dist already present; skipping build/copy")
            return

        # Copy from repo frontend/dist if present
        if (repo_frontend_dist / "index.html").exists():
            if src_frontend_dist.exists():
                shutil.rmtree(src_frontend_dist)
            shutil.copytree(repo_frontend_dist, src_frontend_dist)
            self.app.display_info("Copied frontend/dist -> src/frontend_dist for packaging")
            return

        # No assets available; fail fast with guidance
        raise RuntimeError(
            "Packaged dashboard (src/frontend_dist) missing and frontend/dist not found. "
            "Run 'make build_package' to generate assets before packaging/uvx."
        )
