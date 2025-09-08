import asyncio
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import TextIO

import anyio
from anyio import to_thread
from loguru import logger as log

# Track active stderr pipe endpoints so we can force-close on shutdown
_ACTIVE_PIPES: set[tuple[TextIO, TextIO]] = set()
_shutting_down: bool = False


def install_stdio_client_stderr_capture() -> None:  # noqa: C901
    """
    Monkeypatch mcp.client.stdio.stdio_client so child process stderr is
    routed to our logger at trace level with a stable prefix.

    If an explicit errlog is provided by the caller, we respect it and do not capture.
    """
    try:
        from mcp.client import stdio as _mcp_stdio
    except Exception as e:  # noqa: BLE001
        log.debug(f"stdio capture: MCP stdio not available: {e}")
        return

    _original_stdio_client = _mcp_stdio.stdio_client

    @asynccontextmanager
    async def _edison_stdio_client(  # noqa: C901
        server: _mcp_stdio.StdioServerParameters, errlog: TextIO | None = sys.stderr
    ) -> AsyncIterator[tuple[object, object]]:
        # Respect non-default errlog
        if errlog is not None and errlog is not sys.stderr:
            async with _original_stdio_client(server, errlog=errlog) as transport:
                yield transport
                return

        # Create a pipe for stderr capture
        read_fd, write_fd = os.pipe()
        read_fp = os.fdopen(
            read_fd,
            "r",
            buffering=1,
            encoding=server.encoding,
            errors=server.encoding_error_handler,
        )
        write_fp = os.fdopen(
            write_fd,
            "w",
            buffering=1,
            encoding=server.encoding,
            errors=server.encoding_error_handler,
        )
        _ACTIVE_PIPES.add((read_fp, write_fp))

        if sys.platform != "win32":
            # POSIX: integrate with event loop, avoid background thread
            os.set_blocking(read_fd, False)
            loop = asyncio.get_running_loop()
            buffer = b""

            def _on_readable() -> None:
                nonlocal buffer
                try:
                    chunk = os.read(read_fd, 8192)
                except Exception:
                    with suppress(Exception):
                        loop.remove_reader(read_fd)
                    return
                if not chunk:
                    with suppress(Exception):
                        loop.remove_reader(read_fd)
                    return
                buffer += chunk
                while True:
                    try:
                        idx = buffer.index(b"\n")
                    except ValueError:
                        break
                    line = buffer[:idx]
                    buffer = buffer[idx + 1 :]
                    if not _shutting_down:
                        try:
                            text = line.decode(
                                server.encoding, errors=server.encoding_error_handler
                            )
                        except Exception:
                            text = line.decode(errors="replace")
                        log.trace(f"TOOL PROCESS STDERR {text.rstrip()}")

            loop.add_reader(read_fd, _on_readable)
            try:
                async with _original_stdio_client(server, errlog=write_fp) as transport:
                    yield transport
            finally:
                with suppress(Exception):
                    loop.remove_reader(read_fd)
                with suppress(Exception):
                    write_fp.close()
                with suppress(Exception):
                    read_fp.close()
                with suppress(Exception):
                    _ACTIVE_PIPES.discard((read_fp, write_fp))
        else:

            async def _stderr_reader() -> None:
                try:
                    while True:
                        line = await to_thread.run_sync(read_fp.readline)
                        if not line:
                            break
                        if not _shutting_down:
                            log.trace(f"TOOL PROCESS STDERR {line.rstrip()}")
                except Exception as e:  # noqa: BLE001
                    log.debug(f"stderr monitor stopped: {e}")
                finally:
                    with suppress(Exception):
                        read_fp.close()
                    with suppress(Exception):
                        _ACTIVE_PIPES.discard((read_fp, write_fp))

            async with anyio.create_task_group() as tg:
                tg.start_soon(_stderr_reader)
                try:
                    async with _original_stdio_client(server, errlog=write_fp) as transport:
                        yield transport
                finally:
                    with suppress(Exception):
                        write_fp.close()
                    with suppress(Exception):
                        read_fp.close()
                    tg.cancel_scope.cancel()
                    with suppress(Exception):
                        _ACTIVE_PIPES.discard((read_fp, write_fp))

    try:
        _mcp_stdio.stdio_client = _edison_stdio_client  # type: ignore[assignment]
        log.debug("stdio capture: installed stdio_client monkeypatch")
    except Exception as e:  # noqa: BLE001
        log.debug(f"stdio capture: failed to install monkeypatch: {e}")
