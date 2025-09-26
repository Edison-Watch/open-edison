import contextlib

from PyInstaller.utils.hooks import copy_metadata

datas = []

with contextlib.suppress(Exception):
    datas += copy_metadata("fastapi")
