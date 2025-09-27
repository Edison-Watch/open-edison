import contextlib

from PyInstaller.utils.hooks import copy_metadata

datas: list[tuple[str, str]] = []

for pkg in [
    "fastmcp",
]:
    with contextlib.suppress(Exception):
        datas += copy_metadata(pkg)
