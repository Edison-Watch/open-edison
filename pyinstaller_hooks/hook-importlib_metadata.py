import contextlib

from PyInstaller.utils.hooks import copy_metadata

datas = []

# Ensure metadata for key dependencies is present when frozen
for pkg in [
    "fastmcp",
    "fastapi",
    "uvicorn",
    "pydantic",
    "loguru",
]:
    with contextlib.suppress(Exception):
        datas += copy_metadata(pkg)
