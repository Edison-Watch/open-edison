"""
Configuration management for Open Edison

Simple JSON-based configuration for single-user MCP proxy.
No database, no multi-user support - just local file-based config.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from loguru import logger as log

# Get the path to the root directory
root_dir = Path(__file__).parent.parent


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

    def __post_init__(self):
        if self.env is None:
            self.env = {}


@dataclass
class Config:
    """Main configuration class"""

    server: ServerConfig
    logging: LoggingConfig
    mcp_servers: list[MCPServerConfig]

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
            data = json.load(f)

        return cls(
            server=ServerConfig(**data.get("server", {})),
            logging=LoggingConfig(**data.get("logging", {})),
            mcp_servers=[
                MCPServerConfig(**server_data) for server_data in data.get("mcp_servers", [])
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
