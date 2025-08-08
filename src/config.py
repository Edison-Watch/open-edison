"""
Configuration management for Open Edison

Simple JSON-based configuration for single-user MCP proxy.
No database, no multi-user support - just local file-based config.
"""

import json
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from loguru import logger as log

# Get the path to the root directory
root_dir = Path(__file__).parent.parent


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
class Config:
    """Main configuration class"""

    server: ServerConfig
    logging: LoggingConfig
    mcp_servers: list[MCPServerConfig]

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
        """Load configuration from JSON file"""
        if config_path is None:
            config_path = root_dir / "config.json"

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

        return cls(
            server=ServerConfig(**server_data),  # type: ignore
            logging=LoggingConfig(**logging_data),  # type: ignore
            mcp_servers=[
                MCPServerConfig(**server_item)  # type: ignore
                for server_item in mcp_servers_data  # type: ignore
            ],
        )

    def save(self, config_path: Path | None = None) -> None:
        """Save configuration to JSON file"""
        if config_path is None:
            config_path = root_dir / "config.json"

        data = {
            "server": asdict(self.server),
            "logging": asdict(self.logging),
            "mcp_servers": [asdict(server) for server in self.mcp_servers],
        }

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
        )


# Load global configuration
config = Config.load()
