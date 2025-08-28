from __future__ import annotations

from pathlib import Path
from typing import Any

# Module constants
DEFAULT_OTLP_METRICS_ENDPOINT: str
root_dir: Path

def get_config_dir() -> Path: ...
def get_config_json_path() -> Path: ...

class ServerConfig:
    host: str
    port: int
    api_key: str

class LoggingConfig:
    level: str
    database_path: str

class MCPServerConfig:
    name: str
    command: str
    args: list[str]
    env: dict[str, str] | None
    enabled: bool
    roots: list[str] | None
    oauth_scopes: list[str] | None
    oauth_client_name: str | None

    def __init__(
        self,
        *,
        name: str,
        command: str,
        args: list[str],
        env: dict[str, str] | None = None,
        enabled: bool = True,
        roots: list[str] | None = None,
        oauth_scopes: list[str] | None = None,
        oauth_client_name: str | None = None,
    ) -> None: ...
    def is_remote_server(self) -> bool: ...
    def get_remote_url(self) -> str | None: ...

class TelemetryConfig:
    enabled: bool
    otlp_endpoint: str | None
    headers: dict[str, str] | None
    export_interval_ms: int

def load_json_file(path: Path) -> dict[str, Any]: ...
def clear_json_file_cache() -> None: ...

class Config:
    server: ServerConfig
    logging: LoggingConfig
    mcp_servers: list[MCPServerConfig]
    telemetry: TelemetryConfig | None

    @property
    def version(self) -> str: ...
    def __init__(self, config_path: Path | None = None) -> None: ...
    def save(self, config_path: Path | None = None) -> None: ...
    def create_default(self) -> None: ...
