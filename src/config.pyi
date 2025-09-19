from pathlib import Path
from typing import Any, overload

# Module constants
DEFAULT_OTLP_METRICS_ENDPOINT: str
root_dir: Path

def get_config_dir() -> Path: ...
def get_config_json_path() -> Path: ...
def repo_defaults_path(filename: str) -> Path: ...
def ensure_permissions_file(
    file_path: Path, *, default_json: dict[str, Any] | None = None
) -> Path: ...
def resolve_json_path_with_bootstrap(filename: str) -> Path: ...

class ServerConfig:
    host: str
    port: int
    api_key: str
    ssl_cert_file: str | None
    ssl_key_file: str | None

class LoggingConfig:
    level: str

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
    def __init__(
        self,
        *,
        enabled: bool = True,
        otlp_endpoint: str | None = None,
        headers: dict[str, str] | None = None,
        export_interval_ms: int = 60000,
    ) -> None: ...

def load_json_file(path: Path) -> dict[str, Any]: ...
def clear_json_file_cache() -> None: ...

class Config:
    @property
    def version(self) -> str: ...
    server: ServerConfig
    logging: LoggingConfig
    mcp_servers: list[MCPServerConfig]
    telemetry: TelemetryConfig | None
    @overload
    def __init__(self, config_path: Path | None = None) -> None: ...
    @overload
    def __init__(
        self,
        server: ServerConfig,
        logging: LoggingConfig,
        mcp_servers: list[MCPServerConfig],
        telemetry: TelemetryConfig | None = None,
    ) -> None: ...
    def save(self, config_path: Path | None = None) -> None: ...
    def create_default(self) -> None: ...
