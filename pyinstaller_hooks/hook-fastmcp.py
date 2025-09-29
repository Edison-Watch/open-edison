from PyInstaller.utils.hooks import copy_metadata

datas: list[tuple[str, str]] = []

datas += copy_metadata("fastmcp")
