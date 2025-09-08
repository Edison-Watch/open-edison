"""
Configuration management for Open Edison

Simple JSON-based configuration for single-user MCP proxy.
No database, no multi-user support - just local file-based config.
"""

import json
import os
import sys
import tomllib
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path
from typing import Any, cast

from loguru import logger as log

# Default OTLP metrics endpoint for central dev collector.
DEFAULT_OTLP_METRICS_ENDPOINT = "https://otel-collector-production-e7a6.up.railway.app/v1/metrics"

# Get the path to the repository/package root directory (module src/ parent)
root_dir = Path(__file__).parent.parent


def get_config_dir() -> Path:
    """Resolve configuration directory for runtime.

    Order of precedence:
    1) Environment variable OPEN_EDISON_CONFIG_DIR (if set)
    2) OS-appropriate user config directory under app name
       - macOS: ~/Library/Application Support/Open Edison
       - Windows: %APPDATA%/Open Edison
       - Linux/Unix: $XDG_CONFIG_HOME/open-edison or ~/.config/open-edison
    """
    env_dir = os.environ.get("OPEN_EDISON_CONFIG_DIR")
    if env_dir:
        try:
            return Path(env_dir).expanduser().resolve()
        except Exception:
            log.warning(f"Failed to resolve OPEN_EDISON_CONFIG_DIR: {env_dir}")

    # Platform-specific defaults
    try:
        if sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
            return (base / "Open Edison").resolve()
        if os.name == "nt":  # Windows
            appdata = os.environ.get("APPDATA")
            base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
            return (base / "Open Edison").resolve()
        # POSIX / Linux
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg).expanduser() if xdg else Path.home() / ".config"
        return (base / "open-edison").resolve()
    except Exception:
        # Ultimate fallback: user home
        return (Path.home() / ".open-edison").resolve()


def get_config_json_path() -> Path:
    """Get the path to the config.json file"""
    return get_config_dir() / "config.json"


@dataclass
class ServerConfig:
    """Server configuration"""

    host: str = "localhost"
    port: int = 3000
    api_key: str = "dev-api-key-change-me"


@dataclass
class LoggingConfig:
    """Logging configuration"""

    level: str = "INFO"
    database_path: str = "sessions.db"


@dataclass
class MCPServerConfig:
    """Individual MCP server configuration"""

    name: str
    command: str
    args: list[str]
    env: dict[str, str] | None = None
    enabled: bool = True
    roots: list[str] | None = None

    oauth_scopes: list[str] | None = None
    """OAuth scopes to request for this server."""

    oauth_client_name: str | None = None
    """Custom client name for OAuth registration."""

    def __post_init__(self):
        if self.env is None:
            self.env = {}

    def is_remote_server(self) -> bool:
        """
        Check if this is a remote MCP server (connects to external HTTPS endpoint).

        Remote servers use mcp-remote with HTTPS URLs and may require OAuth.
        Local servers run as child processes and don't need OAuth.
        """
        # TODO find out if having the remote_server functionality is necessary, and if so how we can make it interact well with servers who don't like the fastmcp networking stack.
        return False
        # if self.command != "npx":
        #     return False

        # # Be tolerant of npx flags by scanning for 'mcp-remote' and the subsequent HTTPS URL
        # try:
        #     if "mcp-remote" not in self.args:
        #         return False
        #     idx: int = self.args.index("mcp-remote")
        #     # Look for first https?:// argument after 'mcp-remote'
        #     for candidate in self.args[idx + 1 :]:
        #         if candidate.startswith(("https://", "http://")):
        #             return candidate.startswith("https://")
        #     return False
        # except Exception:
        #     return False

    def get_remote_url(self) -> str | None:
        """
        Get the remote URL for a remote MCP server.

        Returns:
            The HTTPS URL if this is a remote server, None otherwise
        """
        # TODO see above
        return None
        # # Reuse the same tolerant parsing as is_remote_server
        # if self.command != "npx" or "mcp-remote" not in self.args:
        #     return None
        # try:
        #     # idx: int = self.args.index("mcp-remote")
        #     for candidate in self.args[:]:
        #         if candidate.startswith(("https://", "http://")):
        #             return candidate
        #     return None
        # except Exception:
        #     return None


@dataclass
class TelemetryConfig:
    """Telemetry configuration"""

    enabled: bool = True
    # If not provided, exporter may use environment variables or defaults
    otlp_endpoint: str | None = None
    headers: dict[str, str] | None = None
    export_interval_ms: int = 60000


@cache
def load_json_file(path: Path) -> dict[str, Any]:
    """Load a JSON file from the given path.
    Kept as a separate function because we want to manually clear cache sometimes (update in config)"""
    log.trace(f"Loading configuration from {path}")
    with open(path) as f:
        return json.load(f)


def clear_json_file_cache() -> None:
    """Clear the cache for the JSON file loading"""
    load_json_file.cache_clear()


@dataclass
class Config:
    """Main configuration class"""

    server: ServerConfig
    logging: LoggingConfig
    mcp_servers: list[MCPServerConfig]
    telemetry: TelemetryConfig | None = None

    @property
    def version(self) -> str:
        """Get version from pyproject.toml"""
        try:
            pyproject_path = root_dir / "pyproject.toml"
            if pyproject_path.exists():
                with open(pyproject_path, "rb") as f:
                    pyproject_data = tomllib.load(f)
                    project_data = pyproject_data.get("project", {})  # type: ignore
                    version = project_data.get("version", "unknown")  # type: ignore
                    return str(version)  # type: ignore
            return "unknown"
        except Exception as e:
            log.warning(f"Failed to read version from pyproject.toml: {e}")
            return "unknown"

    def __init__(self, config_path: Path | None = None) -> None:
        """Load configuration from JSON file.

        If a directory path is provided, will look for `config.json` inside it.
        If no path is provided, uses OPEN_EDISON_CONFIG_DIR or project root.
        """
        if config_path is None:
            config_path = get_config_json_path()
        else:
            # If a directory was passed, use config.json inside it
            if config_path.is_dir():
                config_path = config_path / "config.json"

        if not config_path.exists():
            log.warning(f"Config file not found at {config_path}, creating default config")
            self.create_default()
            self.save(config_path)

        data = load_json_file(config_path)

        mcp_servers_data = data.get("mcp_servers", [])  # type: ignore
        server_data = data.get("server", {})  # type: ignore
        logging_data = data.get("logging", {})  # type: ignore
        telemetry_data_obj: object = data.get("telemetry", {})

        # Parse telemetry config with explicit typing to satisfy strict type checker
        td: dict[str, object] = {}
        if isinstance(telemetry_data_obj, dict):
            for k_any, v_any in cast(dict[Any, Any], telemetry_data_obj).items():
                td[str(k_any)] = v_any
        tel_enabled: bool = bool(td.get("enabled", True))
        otlp_raw: object = td.get("otlp_endpoint")
        otlp_endpoint: str | None = (
            str(otlp_raw) if isinstance(otlp_raw, str) and otlp_raw else None
        )
        # If not provided in config, use our central dev collector by default
        if not otlp_endpoint:
            otlp_endpoint = DEFAULT_OTLP_METRICS_ENDPOINT
        headers_val: object = td.get("headers")
        headers_dict: dict[str, str] | None = None
        if isinstance(headers_val, dict):
            headers_dict = {}
            for k_any, v_any in cast(dict[Any, Any], headers_val).items():
                headers_dict[str(k_any)] = str(v_any)
        interval_raw: object = td.get("export_interval_ms")
        export_interval_ms: int = interval_raw if isinstance(interval_raw, int) else 60000
        telemetry_cfg = TelemetryConfig(
            enabled=tel_enabled,
            otlp_endpoint=otlp_endpoint,
            headers=headers_dict,
            export_interval_ms=export_interval_ms,
        )

        self.server = ServerConfig(**server_data)  # type: ignore
        self.logging = LoggingConfig(**logging_data)  # type: ignore
        self.mcp_servers = [
            MCPServerConfig(**server_item)  # type: ignore
            for server_item in mcp_servers_data  # type: ignore
        ]
        self.telemetry = telemetry_cfg

    def save(self, config_path: Path | None = None) -> None:
        """Save configuration to JSON file"""
        if config_path is None:
            config_path = get_config_json_path()
        else:
            # If a directory was passed, save to config.json inside it
            if config_path.is_dir():
                config_path = config_path / "config.json"

        data = {
            "server": asdict(self.server),
            "logging": asdict(self.logging),
            "mcp_servers": [asdict(server) for server in self.mcp_servers],
            "telemetry": asdict(
                self.telemetry if self.telemetry is not None else TelemetryConfig()
            ),
        }

        # Ensure directory exists
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
        except FileExistsError as e:
            # If the parent path exists as a file, not a directory, this will fail
            if config_path.parent.is_file():
                log.error(
                    f"Config directory path {config_path.parent} exists as a file, not a directory"
                )
                log.error("Please remove the file or specify a different config directory")
                raise FileExistsError(
                    f"Config directory path {config_path.parent} exists as a file, not a directory"
                ) from e
            log.error(f"Failed to create config directory {config_path.parent}: {e}")
            raise
        with open(config_path, "w") as f:
            json.dump(data, f, indent=2)

        log.info(f"Configuration saved to {config_path}")

    def create_default(self) -> None:
        """Create default configuration"""
        self.server = ServerConfig()
        self.logging = LoggingConfig()
        self.mcp_servers = [
            MCPServerConfig(
                name="filesystem",
                command="uvx",
                args=["mcp-server-filesystem", "/tmp"],
                enabled=False,
            )
        ]
        self.telemetry = TelemetryConfig(
            enabled=True,
            otlp_endpoint=DEFAULT_OTLP_METRICS_ENDPOINT,
        )
