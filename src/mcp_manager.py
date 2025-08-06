"""
MCP Manager

Handles subprocess management of MCP servers.
Separate from FastMCP to keep concerns clean.
"""

import subprocess

from loguru import logger as log

from src.config import MCPServerConfig, config


class MCPManager:
    """
    Manages MCP server subprocesses.

    This class is responsible for starting/stopping MCP server processes,
    but not for the FastMCP protocol handling.
    """

    def __init__(self):
        self.processes: dict[str, subprocess.Popen[str]] = {}
        self.server_configs: dict[str, MCPServerConfig] = {
            server.name: server for server in config.mcp_servers
        }

    async def start_server(self, server_name: str) -> bool:
        """Start an MCP server subprocess.

        Returns whether a new process was started (False if already running).
        Raises on error when creating server process.
        """
        if server_name in self.processes and self.processes[server_name].poll() is None:
            log.warning(f"Server {server_name} is already running")
            return False

        server_config = self.server_configs.get(server_name)
        if not server_config:
            raise ValueError(f"Server configuration not found: {server_name}")

        if not server_config.enabled:
            raise ValueError(f"Server {server_name} is disabled")

        try:
            # Build the command
            cmd = [server_config.command] + server_config.args

            # Set up environment - inherit system environment and add server-specific vars
            import os

            env = os.environ.copy()
            if server_config.env:
                env.update(server_config.env)

            log.info(f"Starting MCP server {server_name}: {' '.join(cmd)}")

            # Start the process
            process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.PIPE,
                text=True,
            )

            self.processes[server_name] = process
            log.info(f"✅ MCP server {server_name} started with PID {process.pid}")

        except Exception as e:
            log.error(f"Failed to start MCP server {server_name}: {e}")
            raise

        return True

    async def stop_server(self, server_name: str) -> None:
        """Stop an MCP server subprocess."""
        if server_name not in self.processes:
            log.warning(f"Server {server_name} is not running")
            return

        process = self.processes[server_name]

        try:
            if process.poll() is None:  # Process is still running
                log.info(f"Stopping MCP server {server_name} (PID {process.pid})")

                # Try graceful shutdown first
                process.terminate()

                # Wait for graceful shutdown
                try:
                    _ = process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # Force kill if graceful shutdown fails
                    log.warning(f"Force killing MCP server {server_name}")
                    process.kill()
                    _ = process.wait()

                log.info(f"✅ MCP server {server_name} stopped")

            del self.processes[server_name]

        except Exception as e:
            log.error(f"Failed to stop MCP server {server_name}: {e}")
            raise

    async def is_server_running(self, server_name: str) -> bool:
        """Check if a server subprocess is running."""
        if server_name not in self.processes:
            return False

        process = self.processes[server_name]
        return process.poll() is None

    async def shutdown(self) -> None:
        """Shutdown all running server subprocesses."""
        log.info("Shutting down all MCP servers")

        for server_name in list(self.processes.keys()):
            await self.stop_server(server_name)

        log.info("✅ All MCP servers stopped")

    def get_server_status(self) -> list[dict[str, str | bool]]:
        """Get status of all configured servers."""
        return [
            {
                "name": server.name,
                "enabled": server.enabled,
                "running": server.name in self.processes
                and self.processes[server.name].poll() is None,
            }
            for server in config.mcp_servers
        ]
