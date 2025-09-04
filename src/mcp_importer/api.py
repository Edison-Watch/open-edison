# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
import contextlib
from enum import Enum
from pathlib import Path
from typing import Any

import questionary
from fastmcp import Client as FastMCPClient
from fastmcp import FastMCP
from fastmcp.client.auth.oauth import FileTokenStorage
from loguru import logger as log  # kept for non-TUI contexts; printing used in TUI flows

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
from src.oauth_override import OpenEdisonOAuth
from src.tools.io import suppress_fds


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

    async def _verify_async() -> bool:  # noqa: C901
        if not server.command.strip():
            return False
        oauth_info = None

        # If this is a remote server, consult OAuth requirement first. Only skip
        # verification when OAuth is actually required and no tokens are present.
        if server.is_remote_server():
            remote_url: str | None = server.get_remote_url()
            if remote_url:
                oauth_info = await get_oauth_manager().check_oauth_requirement(
                    server.name, remote_url
                )
                if oauth_info.status != OAuthStatus.NOT_REQUIRED:
                    # Token presence check
                    storage = FileTokenStorage(
                        server_url=remote_url, cache_dir=get_oauth_manager().cache_dir
                    )
                    tokens = await storage.get_tokens()
                    no_tokens: bool = not tokens or (
                        not getattr(tokens, "access_token", None)
                        and not getattr(tokens, "refresh_token", None)
                    )
                    # Detect if inline headers are present in args (translated from config)
                    has_inline_headers: bool = any(
                        (a == "--header" or a.startswith("--header")) for a in server.args
                    )
                    if (
                        oauth_info.status == OAuthStatus.NEEDS_AUTH
                        and no_tokens
                        and not has_inline_headers
                    ):
                        questionary.print(
                            f"Skipping verification for remote server '{server.name}' pending OAuth",
                            style="bold fg:ansiyellow",
                        )
                        return True

        # Remote servers
        if server.is_remote_server():
            connection_timeout = 10.0
            remote_url = server.get_remote_url()
            if remote_url:
                # If inline headers are specified (e.g., API key), verify via proxy to honor headers
                has_inline_headers_remote: bool = any(
                    (a == "--header" or a.startswith("--header")) for a in server.args
                )
                if has_inline_headers_remote:
                    backend_cfg_remote: dict[str, Any] = {
                        "mcpServers": {
                            server.name: {
                                "command": server.command,
                                "args": server.args,
                                "env": server.env or {},
                                **({"roots": server.roots} if server.roots else {}),
                            }
                        }
                    }
                    proxy_remote: FastMCP[Any] | None = None
                    host_remote: FastMCP[Any] | None = None
                    try:
                        # TODO: In debug mode, do not suppress child process output.
                        with suppress_fds(suppress_stdout=True, suppress_stderr=True):
                            proxy_remote = FastMCP.as_proxy(backend_cfg_remote)
                            host_remote = FastMCP(name=f"open-edison-verify-host-{server.name}")
                            host_remote.mount(proxy_remote, prefix=server.name)

                            async def _list_tools_only() -> Any:
                                return await host_remote._tool_manager.list_tools()  # type: ignore[attr-defined]

                            await asyncio.wait_for(_list_tools_only(), timeout=10.0)
                        return True
                    except Exception as e:
                        log.error(
                            "MCP remote (headers) verification failed for '{}': {}", server.name, e
                        )
                        return False
                    finally:
                        for obj in (host_remote, proxy_remote):
                            if isinstance(obj, FastMCP):
                                with contextlib.suppress(Exception):
                                    result = obj.shutdown()  # type: ignore[attr-defined]
                                    await asyncio.wait_for(result, timeout=2.0)  # type: ignore[func-returns-value]
                # Otherwise, avoid triggering OAuth flows during verification
                ping_succeeded = False
                try:
                    if oauth_info is None:
                        oauth_info = await get_oauth_manager().check_oauth_requirement(
                            server.name, remote_url
                        )
                    # If OAuth is needed or we are already authenticated, don't initiate browser flows here
                    if oauth_info.status in (OAuthStatus.NEEDS_AUTH, OAuthStatus.AUTHENTICATED):
                        return True
                    # NOT_REQUIRED: quick unauthenticated ping
                    # TODO: In debug mode, do not suppress child process output.
                    questionary.print(
                        f"Testing connection to '{server.name}'... (timeout: {connection_timeout}s)",
                        style="bold fg:ansigreen",
                    )
                    log.debug(f"Establishing contact with remote server '{server.name}'")
                    async with asyncio.timeout(connection_timeout):
                        async with FastMCPClient(
                            remote_url,
                            auth=None,
                            timeout=connection_timeout,
                            init_timeout=connection_timeout,
                        ) as client:
                            log.debug(f"Connection established to '{server.name}'; pinging...")
                            with suppress_fds(suppress_stdout=True, suppress_stderr=True):
                                await asyncio.wait_for(fut=client.ping(), timeout=1.0)
                            log.info(f"Ping received from '{server.name}'; shutting down client")
                            ping_succeeded = True
                        log.debug(f"Client '{server.name}' shut down")
                    return ping_succeeded
                except TimeoutError:
                    if ping_succeeded:
                        questionary.print(
                            f"Ping received from '{server.name}' but shutdown timed out (treating as success)",
                            style="bold fg:ansiyellow",
                        )
                    else:
                        questionary.print(
                            f"Verification timed out (> {connection_timeout}s) for '{server.name}'",
                            style="bold fg:ansired",
                        )
                    return ping_succeeded
                except Exception as e:  # noqa: BLE001
                    questionary.print(
                        f"Verification failed for '{server.name}': {e}", style="bold fg:ansired"
                    )
                    return False

        # Local/stdio servers: mount via proxy and perform a single light operation (tools only)
        backend_cfg_local: dict[str, Any] = {
            "mcpServers": {
                server.name: {
                    "command": server.command,
                    "args": server.args,
                    "env": server.env or {},
                    **({"roots": server.roots} if server.roots else {}),
                }
            }
        }

        proxy_local: FastMCP[Any] | None = None
        host_local: FastMCP[Any] | None = None
        try:
            # TODO: In debug mode, do not suppress child process output.
            log.info("Checking properties of '{}'...", server.name)
            with suppress_fds(suppress_stdout=True, suppress_stderr=True):
                proxy_local = FastMCP.as_proxy(backend_cfg_local)
                host_local = FastMCP(name=f"open-edison-verify-host-{server.name}")
                host_local.mount(proxy_local, prefix=server.name)
            log.info("MCP properties check succeeded for '{}'", server.name)

            async def _list_tools_only() -> Any:
                return await host_local._tool_manager.list_tools()  # type: ignore[attr-defined]

            await asyncio.wait_for(_list_tools_only(), timeout=30.0)
            return True
        except Exception as e:
            questionary.print(
                f"Verification failed for '{server.name}': {e}", style="bold fg:ansired"
            )
            return False
        finally:
            for obj in (host_local, proxy_local):
                if isinstance(obj, FastMCP):
                    with contextlib.suppress(Exception):
                        result = obj.shutdown()  # type: ignore[attr-defined]
                        await asyncio.wait_for(result, timeout=2.0)  # type: ignore[func-returns-value]

    return asyncio.run(_verify_async())


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
            # Debug info prior to starting OAuth
            print(
                "[OAuth] Starting authorization",
                f"server={server.name}",
                f"remote_url={remote_url}",
                f"cache_dir={oauth_manager.cache_dir}",
                f"scopes={server.oauth_scopes}",
                f"client_name={server.oauth_client_name or 'Open Edison Setup'}",
            )

            oauth = OpenEdisonOAuth(
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
            storage = FileTokenStorage(
                server_url=remote_url, cache_dir=get_oauth_manager().cache_dir
            )
            tokens = await storage.get_tokens()
            return bool(tokens and (tokens.access_token or tokens.refresh_token))
        except Exception:
            return False

    return asyncio.run(_check_async())
