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
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass
