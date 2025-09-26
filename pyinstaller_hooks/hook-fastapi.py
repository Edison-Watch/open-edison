from PyInstaller.utils.hooks import copy_metadata

datas = []

try:
    datas += copy_metadata("fastapi")
except Exception:
    pass
