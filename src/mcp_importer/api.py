# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
from collections.abc import Awaitable
from enum import Enum
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from loguru import logger as log

from src.config import Config, MCPServerConfig, get_config_json_path
from src.mcp_importer import paths as _paths
from src.mcp_importer.exporters import (
    ExportResult,
    export_to_claude_code,
    export_to_cursor,
    export_to_vscode,
)
from src.mcp_importer.importers import (
    import_from_claude_code,
    import_from_cursor,
    import_from_vscode,
)
from src.mcp_importer.merge import MergePolicy, merge_servers
from src.oauth_manager import OAuthStatus, get_oauth_manager


class CLIENT(str, Enum):
    CURSOR = "cursor"
    VSCODE = "vscode"
    CLAUDE_CODE = "claude-code"

    def __str__(self) -> str:
        return self.value.capitalize()

    def __repr__(self) -> str:
        return str(self)


def detect_clients() -> set[CLIENT]:
    detected: set[CLIENT] = set()
    if _paths.detect_cursor_config_path() is not None:
        detected.add(CLIENT.CURSOR)
    if _paths.detect_vscode_config_path() is not None:
        detected.add(CLIENT.VSCODE)
    if _paths.detect_claude_code_config_path() is not None:
        detected.add(CLIENT.CLAUDE_CODE)
    return detected


def import_from(client: CLIENT) -> list[MCPServerConfig]:
    if client == CLIENT.CURSOR:
        return import_from_cursor()
    if client == CLIENT.VSCODE:
        return import_from_vscode()
    if client == CLIENT.CLAUDE_CODE:
        return import_from_claude_code()
    raise ValueError(f"Unsupported client: {client}")


def save_imported_servers(
    servers: list[MCPServerConfig],
    *,
    dry_run: bool = False,
    merge_policy: str = MergePolicy.SKIP,
    config_dir: Path | None = None,
) -> Path | None:
    target_path: Path = (
        get_config_json_path() if config_dir is None else (Path(config_dir) / "config.json")
    )
    if dry_run:
        print(
            f"[dry-run] Would import {len(servers)} server(s) and save to config.json (at {target_path})"
        )
        return None
    cfg: Config = Config(target_path)
    merged = merge_servers(existing=cfg.mcp_servers, imported=servers, policy=merge_policy)
    cfg.mcp_servers = merged
    cfg.save(target_path)
    return target_path


def export_edison_to(
    client: CLIENT,
    *,
    url: str = "http://localhost:3000/mcp/",
    api_key: str = "dev-api-key-change-me",
    server_name: str = "open-edison",
    dry_run: bool = False,
    force: bool = False,
    create_if_missing: bool = False,
) -> ExportResult:
    if dry_run:
        print(
            f"[dry-run] Would export Open Edison to '{client}' (backup and replace editor MCP config)"
        )
        return ExportResult(
            target_path=Path(""),
            backup_path=None,
            wrote_changes=False,
            dry_run=True,
        )
    match client:
        case CLIENT.CURSOR:
            return export_to_cursor(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )
        case CLIENT.VSCODE:
            return export_to_vscode(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )
        case CLIENT.CLAUDE_CODE:
            return export_to_claude_code(
                url=url,
                api_key=api_key,
                server_name=server_name,
                dry_run=dry_run,
                force=force,
                create_if_missing=create_if_missing,
            )


def verify_mcp_server(server: MCPServerConfig) -> bool:  # noqa
    """Minimal validation: try listing tools/resources/prompts via FastMCP within a timeout."""

    async def _verify_async() -> bool:
        if not server.command.strip():
            return False

        # Inline backend config and capability listing (no extra helpers)
        backend_cfg: dict[str, Any] = {
            "mcpServers": {
                server.name: {
                    "command": server.command,
                    "args": server.args,
                    "env": server.env or {},
                    **({"roots": server.roots} if server.roots else {}),
                }
            }
        }

        proxy: FastMCP[Any] | None = None
        host: FastMCP[Any] | None = None
        try:
            proxy = FastMCP.as_proxy(backend_cfg)
            host = FastMCP(name=f"open-edison-verify-host-{server.name}")
            host.mount(proxy, prefix=server.name)

            async def _call_list(kind: str) -> Any:
                manager_name = {
                    "tools": "_tool_manager",
                    "resources": "_resource_manager",
                    "prompts": "_prompt_manager",
                }[kind]
                manager = getattr(host, manager_name)
                return await getattr(manager, f"list_{kind}")()

            await asyncio.wait_for(
                asyncio.gather(
                    _call_list("tools"),
                    _call_list("resources"),
                    _call_list("prompts"),
                ),
                timeout=30.0,
            )
            return True
        except Exception as e:
            log.error("MCP verification failed for '{}': {}", server.name, e)
            return False
        finally:
            try:
                for obj in (host, proxy):
                    if isinstance(obj, FastMCP):
                        result = obj.shutdown()  # type: ignore[attr-defined]
                        if isinstance(result, Awaitable):
                            await result  # type: ignore[func-returns-value]
            except Exception:
                pass

    return asyncio.run(_verify_async())


def server_needs_oauth(server: MCPServerConfig) -> bool:
    """Return True if the remote server currently needs OAuth; False otherwise."""

    async def _needs_oauth_async() -> bool:
        if not server.is_remote_server():
            return False
        info = await get_oauth_manager().check_oauth_requirement(
            server.name, server.get_remote_url()
        )
        return info.status == OAuthStatus.NEEDS_AUTH

    return asyncio.run(_needs_oauth_async())


def authorize_server_oauth(server: MCPServerConfig) -> bool:
    """Run an interactive OAuth flow for a remote MCP server and cache tokens.

    Returns True if authorization succeeded (tokens cached and a ping succeeded),
    False otherwise. Local servers return True immediately.
    """

    async def _authorize_async() -> bool:
        if not server.is_remote_server():
            return True

        remote_url: str | None = server.get_remote_url()
        if not remote_url:
            log.error("OAuth requested for remote server '{}' but no URL found", server.name)
            return False

        oauth_manager = get_oauth_manager()

        try:
            # Import lazily to avoid import-time side effects
            from fastmcp import Client as FastMCPClient  # type: ignore
            from fastmcp.client.auth import OAuth  # type: ignore

            # Debug info prior to starting OAuth
            print(
                "[OAuth] Starting authorization",
                f"server={server.name}",
                f"remote_url={remote_url}",
                f"cache_dir={oauth_manager.cache_dir}",
                f"scopes={server.oauth_scopes}",
                f"client_name={server.oauth_client_name or 'Open Edison Setup'}",
            )

            oauth = OAuth(
                mcp_url=remote_url,
                scopes=server.oauth_scopes,
                client_name=server.oauth_client_name or "Open Edison Setup",
                token_storage_cache_dir=oauth_manager.cache_dir,
                callback_port=50001,
            )

            # Establish a connection to trigger OAuth if needed
            async with FastMCPClient(remote_url, auth=oauth) as client:  # type: ignore
                log.info(
                    "Starting OAuth flow for '{}' (a browser window may open; if not, follow the printed URL)",
                    server.name,
                )
                await client.ping()

            # Refresh cached status
            info = await oauth_manager.check_oauth_requirement(server.name, remote_url)

            # Post-authorization token inspection (no secrets printed)
            try:
                from fastmcp.client.auth.oauth import FileTokenStorage  # type: ignore

                storage = FileTokenStorage(server_url=remote_url, cache_dir=oauth_manager.cache_dir)
                tokens = await storage.get_tokens()
                access_present = bool(getattr(tokens, "access_token", None)) if tokens else False
                refresh_present = bool(getattr(tokens, "refresh_token", None)) if tokens else False
                expires_at = getattr(tokens, "expires_at", None) if tokens else None
                print(
                    "[OAuth] Authorization result:",
                    f"status={info.status.value}",
                    f"has_refresh_token={info.has_refresh_token}",
                    f"token_expires_at={info.token_expires_at or expires_at}",
                    f"tokens_cached=access:{access_present}/refresh:{refresh_present}",
                )
            except Exception as _e:  # noqa: BLE001
                print("[OAuth] Authorization completed, but token inspection failed:", _e)

            log.info("OAuth completed and tokens cached for '{}'", server.name)
            return True
        except Exception as e:  # noqa: BLE001
            log.error("OAuth authorization failed for '{}': {}", server.name, e)
            print("[OAuth] Authorization failed:", e)
            return False

    return asyncio.run(_authorize_async())


def has_oauth_tokens(server: MCPServerConfig) -> bool:
    """Return True if cached OAuth tokens exist for the remote server.

    Local servers return True (no OAuth needed).
    """

    async def _check_async() -> bool:
        if not server.is_remote_server():
            return True

        remote_url: str | None = server.get_remote_url()
        if not remote_url:
            return False

        try:
            from fastmcp.client.auth.oauth import FileTokenStorage  # type: ignore

            storage = FileTokenStorage(
                server_url=remote_url, cache_dir=get_oauth_manager().cache_dir
            )
            tokens = await storage.get_tokens()
            return bool(tokens and (tokens.access_token or tokens.refresh_token))
        except Exception:
            return False

    return asyncio.run(_check_async())
