import os
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def suppress_fds(*, suppress_stdout: bool = False, suppress_stderr: bool = True) -> Iterator[None]:
    """Temporarily redirect process-level stdout/stderr to os.devnull.

    Args:
        suppress_stdout: If True, redirect fd 1 to devnull
        suppress_stderr: If True, redirect fd 2 to devnull

    Yields:
        None
    """
    saved: list[tuple[int, int]] = []
    try:
        if suppress_stdout:
            saved.append((1, os.dup(1)))
            devnull_out = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull_out, 1)
            os.close(devnull_out)
        if suppress_stderr:
            saved.append((2, os.dup(2)))
            devnull_err = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull_err, 2)
            os.close(devnull_err)
        yield
    finally:
        for fd, backup in saved:
            try:
                os.dup2(backup, fd)
            finally:
                os.close(backup)
