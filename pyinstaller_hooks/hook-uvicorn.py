import contextlib

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

# Include uvicorn's dynamic submodules that are imported via strings
hiddenimports: list[str] = collect_submodules("uvicorn")

datas: list[tuple[str, str]] = []

with contextlib.suppress(Exception):
    datas += copy_metadata("uvicorn")
