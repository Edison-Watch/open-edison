"""
Lightweight shim to satisfy optional MySQLdb import discovery at build-time.
This does not provide a real MySQL client; it prevents linker errors when
SQLAlchemy probes for MySQLdb. If MySQL is required, install mysqlclient.
"""


class _MissingMySQLClient(Exception):
    pass


def connect(*args, **kwargs):  # pragma: no cover
    raise _MissingMySQLClient(
        "MySQLdb shim: mysqlclient is not bundled. Install mysqlclient to use MySQL."
    )
