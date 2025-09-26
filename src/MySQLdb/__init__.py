"""
Lightweight shim to satisfy optional MySQLdb import discovery at build-time.
This does not provide a real MySQL client; it prevents linker errors when
SQLAlchemy probes for MySQLdb. If MySQL is required, install mysqlclient.
"""


class _MissingMySQLClientError(Exception):
    pass


def connect(*args, **kwargs):  # noqa
    raise _MissingMySQLClientError(
        "MySQLdb shim: mysqlclient is not bundled. Install mysqlclient to use MySQL."
    )
