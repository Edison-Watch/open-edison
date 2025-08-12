"""Type helpers for MCP importer.

We avoid strict static typing here due to dynamic imports from the Open Edison
runtime environment. Tools may use pyright; disable missing import noise where appropriate.
"""

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportUnknownArgumentType=false
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol


class MCPServerLike(Protocol):
    name: str
    command: str
    args: list[str]
    env: dict[str, str]
    enabled: bool
    roots: list[str] | None


if TYPE_CHECKING:
    # For type-checkers, import the real class
    from config import MCPServerConfig as MCPServerConfigT  # pragma: no cover
else:  # Runtime fallback; actual import is done in constructors
    MCPServerConfigT = Any  # type: ignore[misc, assignment]


def new_mcp_server_config(
    *,
    name: str,
    command: str,
    args: list[str],
    env: dict[str, str] | None,
    enabled: bool,
    roots: list[str] | None,
) -> MCPServerConfigT:
    """Construct a MCPServerConfig instance from src.config at runtime.

    This avoids hard module-level imports while keeping type-checkers satisfied via TYPE_CHECKING.
    """
    from config import MCPServerConfig  # runtime import

    return MCPServerConfig(
        name=name,
        command=command,
        args=args,
        env=env or {},
        enabled=enabled,
        roots=roots,
    )
