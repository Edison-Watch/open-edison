from dataclasses import dataclass
from enum import Enum

from src.mcp_importer.api import detect_clients


class MCPServerSource(Enum):
    CURSOR = "cursor"

class MCPCientType(Enum):
    CURSOR = "cursor"

@dataclass
class ErrorMessage:
    message: str
    additional_info: str | None = None


@dataclass
class MCPServerConfig:
    name: str
    command: str
    args: list[str]
    env: dict[str, str]

def is_oauth_server(config: MCPServerConfig) -> bool:
    # TODO: Implement this
    return False

def find_all_mcp_sources() -> list[MCPServerSource]:
    # TODO: Implement this
    return [MCPServerSource.CURSOR]

def find_all_mcp_clients() -> list[MCPCientType]:
    # TODO: Implement this
    return [MCPCientType.CURSOR]

    return detect_clients()

def get_mcp_configs_from_source(source: MCPServerSource) -> list[MCPServerConfig] | ErrorMessage:
    # TODO: Implement this
    return [MCPServerConfig(
        name="open-edison",
        command="npx",
        args=["-y", "mcp-remote", "http://localhost:3000/mcp/", "--http-only", "--header", "Authorization: Bearer dev-api-key-change-me"],
        env={}
    )]

def apply_configs_to_client(client: MCPCientType) -> None |ErrorMessage:
    # TODO: Implement this
    return None

def verify_mcp_config(config: MCPServerConfig) -> bool:
    # TODO: Implement this
    return True