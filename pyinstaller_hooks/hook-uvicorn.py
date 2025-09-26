from PyInstaller.utils.hooks import collect_submodules, copy_metadata

# Include uvicorn's dynamic submodules that are imported via strings
hiddenimports: list[str] = collect_submodules("uvicorn")

datas: list[tuple[str, str]] = []

try:
    datas += copy_metadata("uvicorn")
except Exception:
    pass
