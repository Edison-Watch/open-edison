import contextlib

from PyInstaller.utils.hooks import copy_metadata

datas: list[tuple[str, str]] = []

with contextlib.suppress(Exception):
    datas += copy_metadata("fastapi")
