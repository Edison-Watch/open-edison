#!/usr/bin/env python3
import asyncio
import contextlib
import os
import signal
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from fastmcp import Client as FastMCPClient
from loguru import logger as log

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_DIR = REPO_ROOT / "dev_config_dir"
FASTAPI_HEALTH_URL = "http://127.0.0.1:3001/health"
FASTMCP_URL = "http://127.0.0.1:3000/mcp/"
N_ITERATIONS = 100


async def wait_for_health(url: str, timeout_s: float = 10.0) -> dict[str, Any]:
    start = time.monotonic()
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=3.0) as client:
        while time.monotonic() - start < timeout_s:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict) and data.get("status") == "healthy":
                        return data
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
            await asyncio.sleep(0.5)
    if last_exc:
        raise TimeoutError(f"Timed out waiting for health at {url}: {last_exc}")
    raise TimeoutError(f"Timed out waiting for health at {url}")


@contextlib.asynccontextmanager
async def open_edison_server():
    """
    Async context manager that starts the Open Edison server and ensures teardown.
    Yields the subprocess.Popen handle.
    """
    # Prefer running the installed console script if available; else fall back to module.
    # We use the same Python interpreter to avoid venv mismatches.
    cmd = [sys.executable, "-m", "src"]

    log.info("Starting Open Edison server")
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,  # new process group for clean signaling
    )

    async def _tail_output() -> None:
        if proc.stdout is None:
            return
        loop = asyncio.get_running_loop()
        try:
            while True:
                line = await loop.run_in_executor(None, proc.stdout.readline)
                if not line:
                    break
                log.debug(f"[server] {line.strip()}")
        except Exception as exc:  # noqa: BLE001
            log.debug(f"Output tailer ended: {exc}")

    tail_task = asyncio.create_task(_tail_output())

    # Wait for readiness on FastAPI
    log.info("Waiting for /health to be healthy...")
    health = await wait_for_health(FASTAPI_HEALTH_URL)
    log.info(f"Health OK: {health}")

    yield proc
    log.info("Shutting down server...")
    if proc.poll() is None:
        with contextlib.suppress(Exception):
            pgid = os.getpgid(proc.pid)
            log.debug(f"Sending SIGINT to process {proc.pid} and group {pgid}")
            os.killpg(pgid, signal.SIGINT)
            proc.send_signal(signal.SIGINT)

    # Wait 0.5 seconds for the server to shutdown
    await asyncio.sleep(0.5)

    # Sigkill the server if alive
    if proc.poll() is None:
        log.debug(f"Sending SIGKILL to process {proc.pid}")
        os.kill(proc.pid, signal.SIGKILL)
        proc.send_signal(signal.SIGKILL)

    with contextlib.suppress(Exception):
        tail_task.cancel()
        await asyncio.wait_for(tail_task, timeout=1.5)
        if proc.stdout is not None:
            with contextlib.suppress(Exception):
                proc.stdout.close()
    log.info(f"Server process return code: {proc.returncode}")


async def _poll_health_down(timeout_s: float = 5.0) -> bool:
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=1.0) as client:
        while time.monotonic() - start < timeout_s:
            try:
                await client.get(FASTAPI_HEALTH_URL)
            except Exception:
                return True
            await asyncio.sleep(0.2)
    return False


async def call_builtin_echo(client: FastMCPClient) -> None:
    await client.call_tool("builtin_echo", {"text": "Hello, world!"})


@dataclass
class ToolPerfInfo:
    name: str
    timings: list[float]

    @property
    def mean_ms(self) -> float:
        return statistics.mean(self.timings)

    @property
    def stdev_ms(self) -> float:
        return statistics.stdev(self.timings) if len(self.timings) > 1 else 0.0


async def bench_tool(
    client: FastMCPClient, tool_name: str, tool_args: dict[str, Any], n_iters: int = N_ITERATIONS
) -> ToolPerfInfo:
    timings: list[float] = []
    for _ in range(n_iters):
        t0 = time.perf_counter()
        await client.call_tool(tool_name, tool_args)
        t1 = time.perf_counter()
        timings.append((t1 - t0) * 1000.0)
    return ToolPerfInfo(name=tool_name, timings=timings)


async def run_harness() -> int:
    tools_to_be_tested = [
        "builtin_echo",
        "builtin_get_server_info",
        "builtin_get_security_status",
        "builtin_get_available_tools",
        "builtin_tools_changed",
    ]
    tool_args = {
        "builtin_echo": {"text": "Hello, world!"},
        "builtin_get_server_info": {},
        "builtin_get_security_status": {},
        "builtin_get_available_tools": {},
        "builtin_tools_changed": {},
    }

    tool_perf_infos: dict[str, ToolPerfInfo] = {}

    async with open_edison_server() as _proc:
        # Health check passed, so we can proceed

        log.info("--------------------------------")
        # Connect FastMCP client and list tools
        async with FastMCPClient(FASTMCP_URL) as client:
            log.info("Connected to FastMCP. Listing tools via list_tools...")
            t0 = time.perf_counter()
            result = await client.list_tools()
            dt_ms = (time.perf_counter() - t0) * 1000.0

            log.info(f"list_tools returned {len(result)} tools in {dt_ms:.1f} ms")
            log.info(f"Tool names: {', '.join([t.name for t in result])}")

            log.info("Starting perf test of the builtin_echo tool...")
            for tool_name in tools_to_be_tested:
                log.info(f"Starting perf test of the {tool_name} tool...")
                tool_perf_infos[tool_name] = await bench_tool(
                    client, tool_name, tool_args[tool_name], n_iters=N_ITERATIONS
                )
                log.info("--------------------------------")

        log.info("--------------------------------")

    for tool_name, tool_perf_info in tool_perf_infos.items():
        log.info(
            f"{tool_name} tool: mean {tool_perf_info.mean_ms:.1f} ms, stdev {tool_perf_info.stdev_ms:.1f} ms per call over {N_ITERATIONS} iterations"
        )
        log.info("--------------------------------")

    return 0


def main() -> None:
    raise SystemExit(asyncio.run(run_harness()))


if __name__ == "__main__":
    main()
