"""
Compatibility shim for pysqlite2.
Maps pysqlite2 imports to the built-in sqlite3 module.
"""

# Expose sqlite3 symbols at package level
from sqlite3 import *  # noqa: F401,F403
