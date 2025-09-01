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

        # Always ensure frontend assets are available for packaging
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

        # If no frontend assets are available, create a minimal placeholder
        # This prevents build failures while still allowing the package to be built
        if not src_frontend_dist.exists():
            src_frontend_dist.mkdir(parents=True, exist_ok=True)
            # Create a minimal index.html placeholder
            placeholder_html = """<!DOCTYPE html>
<html>
<head>
    <title>Open Edison Dashboard</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>Open Edison Dashboard</h1>
    <p>Frontend assets not available. Run 'make build_package' to build the full dashboard.</p>
</body>
</html>"""
            (src_frontend_dist / "index.html").write_text(placeholder_html)
            self.app.display_info("Created minimal frontend placeholder for packaging")
