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
            # Fall through to defaults
            pass

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


# Back-compat private alias (internal modules may import this)
def _get_config_dir() -> Path:  # noqa: D401
    """Alias to public get_config_dir (maintained for internal imports)."""
    return get_config_dir()


def _default_config_path() -> Path:
    """Determine default config.json path.

    In development (editable or source checkout), prefer repository root
    `config.json` when present. In an installed package (site-packages),
    use the resolved user config dir.
    """
    repo_pyproject = root_dir / "pyproject.toml"
    repo_config = root_dir / "config.json"

    # If pyproject.toml exists next to src/, we are likely in a repo checkout
    if repo_pyproject.exists():
        return repo_config

    # Otherwise, prefer user config directory
    return get_config_dir() / "config.json"


class ConfigError(Exception):
    """Exception raised for configuration-related errors"""

    def __init__(self, message: str, config_path: Path | None = None):
        self.message = message
        self.config_path = config_path
        super().__init__(self.message)


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

    def __post_init__(self):
        if self.env is None:
            self.env = {}


@dataclass
class TelemetryConfig:
    """Telemetry configuration"""

    enabled: bool = True
    # If not provided, exporter may use environment variables or defaults
    otlp_endpoint: str | None = None
    headers: dict[str, str] | None = None
    export_interval_ms: int = 60000


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

    @classmethod
    def load(cls, config_path: Path | None = None) -> "Config":
        """Load configuration from JSON file.

        If a directory path is provided, will look for `config.json` inside it.
        If no path is provided, uses OPEN_EDISON_CONFIG_DIR or project root.
        """
        if config_path is None:
            config_path = _default_config_path()
        else:
            # If a directory was passed, use config.json inside it
            if config_path.is_dir():
                config_path = config_path / "config.json"

        if not config_path.exists():
            log.warning(f"Config file not found at {config_path}, creating default config")
            default_config = cls.create_default()
            default_config.save(config_path)
            return default_config

        with open(config_path) as f:
            data: dict[str, Any] = json.load(f)

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

        return cls(
            server=ServerConfig(**server_data),  # type: ignore
            logging=LoggingConfig(**logging_data),  # type: ignore
            mcp_servers=[
                MCPServerConfig(**server_item)  # type: ignore
                for server_item in mcp_servers_data  # type: ignore
            ],
            telemetry=telemetry_cfg,
        )

    def save(self, config_path: Path | None = None) -> None:
        """Save configuration to JSON file"""
        if config_path is None:
            config_path = _default_config_path()
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
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w") as f:
            json.dump(data, f, indent=2)

        log.info(f"Configuration saved to {config_path}")

    @classmethod
    def create_default(cls) -> "Config":
        """Create default configuration"""
        return cls(
            server=ServerConfig(),
            logging=LoggingConfig(),
            mcp_servers=[
                MCPServerConfig(
                    name="filesystem",
                    command="uvx",
                    args=["mcp-server-filesystem", "/tmp"],
                    enabled=False,
                )
            ],
            telemetry=TelemetryConfig(
                enabled=True,
                otlp_endpoint=DEFAULT_OTLP_METRICS_ENDPOINT,
            ),
        )


# Load global configuration
config = Config.load()
