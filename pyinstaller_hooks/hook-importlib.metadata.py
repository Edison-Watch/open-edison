from PyInstaller.utils.hooks import copy_metadata

datas = []

for pkg in [
    "fastmcp",
]:
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass
