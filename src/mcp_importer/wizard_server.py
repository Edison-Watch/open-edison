#!/usr/bin/env python3
"""
HTTP API server for setup wizard functionality.
Provides REST endpoints for the Electron app to interact with MCP import/export operations.
"""

import json
from collections import defaultdict
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# from src.mcp_importer.parsers import deduplicate_by_name  # Using custom deduplication logic
from loguru import logger as log
from pydantic import BaseModel

from src.config import MCPServerConfig, get_config_dir
from src.mcp_importer.api import (
    CLIENT,
    authorize_server_oauth,
    detect_clients,
    export_edison_to,
    import_from,
    restore_client,
    save_imported_servers,
    verify_mcp_server,
)


# Pydantic models for API requests/responses
class ServerConfig(BaseModel):
    name: str
    command: str
    args: list[str]
    env: dict[str, str]
    enabled: bool
    client: str | None = None  # Track which client this server came from
    roots: list[str] | None = None
    potential_duplicate: bool = False
    duplicate_reason: str | None = None


class ImportRequest(BaseModel):
    clients: list[str]  # List of client names to import from
    dry_run: bool = False
    skip_oauth: bool = False


class ImportResponse(BaseModel):
    success: bool
    servers: list[ServerConfig]
    errors: list[str]
    message: str


class ExportRequest(BaseModel):
    clients: list[str]
    url: str = "http://localhost:3000/mcp/"
    api_key: str = "dev-api-key-change-me"
    server_name: str = "open-edison"
    dry_run: bool = False
    force: bool = False
    create_if_missing: bool = False
    selected_servers: list[str] | None = None


class ExportResponse(BaseModel):
    success: bool
    results: dict[str, Any]
    message: str


class ReplaceRequest(BaseModel):
    clients: list[str]
    url: str = "http://localhost:3000/mcp/"
    api_key: str = "dev-api-key-change-me"
    server_name: str = "open-edison"
    dry_run: bool = False
    force: bool = False
    create_if_missing: bool = True
    selected_servers: list[str] | None = None  # List of server names that were selected for import


class ReplaceResponse(BaseModel):
    success: bool
    results: dict[str, Any]
    message: str


class BackupInfoResponse(BaseModel):
    success: bool
    backups: dict[str, Any]
    message: str


class ClientDetectionResponse(BaseModel):
    success: bool
    clients: list[str]
    message: str


class VerificationRequest(BaseModel):
    servers: list[ServerConfig]
    timeout_seconds: int | None = 30  # Default 30 seconds timeout for verification


class VerificationResponse(BaseModel):
    success: bool
    results: dict[str, str]  # server_name -> verification_result ("success", "failed", "timeout")
    message: str


class OAuthRequest(BaseModel):
    server: ServerConfig


class OAuthResponse(BaseModel):
    success: bool
    message: str


# Create FastAPI app
app = FastAPI(
    title="Open Edison Setup Wizard API",
    description="HTTP API for setup wizard functionality",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


def convert_to_server_config(mcp_config: MCPServerConfig) -> ServerConfig:
    """Convert MCPServerConfig to ServerConfig for API response."""
    return ServerConfig(
        name=mcp_config.name,
        command=mcp_config.command,
        args=mcp_config.args,
        env=mcp_config.env or {},
        enabled=mcp_config.enabled,
        roots=mcp_config.roots,
    )


def convert_from_server_config(server_config: ServerConfig) -> MCPServerConfig:
    """Convert ServerConfig to MCPServerConfig for API processing."""
    return MCPServerConfig(
        name=server_config.name,
        command=server_config.command,
        args=server_config.args,
        env=server_config.env or {},
        enabled=server_config.enabled,
        roots=server_config.roots,
    )


@app.options("/{path:path}")  # noqa
async def options_handler(path: str):
    """Handle CORS preflight requests."""
    return {"message": "OK"}


@app.get("/health")  # noqa
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "setup-wizard-api"}


@app.get("/clients", response_model=ClientDetectionResponse)  # noqa
async def detect_available_clients():
    """Detect available MCP clients on the system."""
    try:
        detected = detect_clients()
        client_names = [client.value for client in detected]
        return ClientDetectionResponse(
            success=True, clients=client_names, message=f"Found {len(client_names)} MCP clients"
        )
    except Exception as e:
        return ClientDetectionResponse(
            success=False, clients=[], message=f"Error detecting clients: {str(e)}"
        )


def _import_servers_from_clients(
    client_names: list[str],
) -> tuple[dict[str, list[MCPServerConfig]], list[str]]:
    """Import servers from each client and track errors."""
    client_server_map: dict[str, list[MCPServerConfig]] = {}
    errors = []

    for client_name in client_names:
        try:
            client = CLIENT(client_name)
            servers = import_from(client)
            client_server_map[client_name] = servers
        except ValueError:
            errors.append(f"Unknown client: {client_name}")  # type: ignore
        except Exception as e:
            errors.append(f"Error importing from {client_name}: {str(e)}")  # type: ignore

    return client_server_map, errors  # type: ignore


def _convert_servers_to_configs(
    client_server_map: dict[str, list[MCPServerConfig]],
) -> tuple[list[ServerConfig], list[MCPServerConfig]]:
    """Convert MCP servers to API ServerConfig format with client info."""
    server_configs: list[ServerConfig] = []
    original_servers: list[MCPServerConfig] = []

    print(f"Client server map: {client_server_map}")
    for client_name, servers in client_server_map.items():
        print(f"Client name: {client_name}")
        for server in servers:
            print(f"-Server: {server}")
            server_config = convert_to_server_config(server)
            server_config.client = client_name
            server_configs.append(server_config)
            original_servers.append(server)

    return server_configs, original_servers


def _detect_duplicate_servers(
    original_servers: list[MCPServerConfig], server_configs: list[ServerConfig]
) -> None:
    """Detect and mark potential duplicate servers."""
    duplicate_reasons: dict[int, set[str]] = defaultdict(set)

    def _mark_duplicates(index_map: dict[Any, list[int]], reason: str) -> None:
        for indices in index_map.values():
            if len(indices) > 1:
                for idx in indices:
                    duplicate_reasons[idx].add(reason)

    # Build index maps for duplicate detection
    exact_map: dict[Any, list[int]] = defaultdict(list)
    name_map: dict[str, list[int]] = defaultdict(list)
    command_args_map: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(list)

    for idx, server in enumerate(original_servers):
        env_items = tuple(sorted((server.env or {}).items()))
        roots_tuple = tuple(server.roots or [])
        exact_key = (
            server.name,
            server.command,
            tuple(server.args),
            env_items,
            server.enabled,
            roots_tuple,
        )
        exact_map[exact_key].append(idx)
        name_map[server.name].append(idx)
        command_args_map[(server.command, tuple(server.args))].append(idx)

    # Mark duplicates based on different criteria
    _mark_duplicates(exact_map, "identical configuration")
    _mark_duplicates(name_map, "same name")
    _mark_duplicates(command_args_map, "same command and args")

    # Update server configs with duplicate information
    for idx, reasons in duplicate_reasons.items():
        server_config = server_configs[idx]
        server_config.potential_duplicate = True
        sorted_reasons = ", ".join(sorted(reasons))
        server_config.duplicate_reason = sorted_reasons


@app.post("/import", response_model=ImportResponse)  # noqa
async def import_mcp_servers(request: ImportRequest):
    """Import MCP servers from specified clients.
    The servers are returned to the server, including client metadata and not deduplicated.
    """
    try:
        # Import servers from all requested clients
        client_server_map, errors = _import_servers_from_clients(request.clients)

        # Convert to API format with client information
        server_configs, original_servers = _convert_servers_to_configs(client_server_map)

        # Detect and mark potential duplicates
        _detect_duplicate_servers(original_servers, server_configs)

        return ImportResponse(
            success=len(server_configs) > 0,
            servers=server_configs,
            errors=errors,  # type: ignore
            message=f"Imported {len(server_configs)} servers from {len(request.clients)} clients",
        )

    except Exception as e:
        return ImportResponse(
            success=False,
            servers=[],
            errors=[str(e)],  # type: ignore
            message=f"Import failed: {str(e)}",
        )


@app.post("/verify", response_model=VerificationResponse)  # noqa
async def verify_servers(request: VerificationRequest):
    """Verify MCP server configurations."""
    try:
        results = {}

        for server_config in request.servers:
            try:
                mcp_config = convert_from_server_config(server_config)
                print(
                    f"Verifying server: {server_config.name} with timeout: {request.timeout_seconds}"
                )
                status = verify_mcp_server(mcp_config, timeout_seconds=request.timeout_seconds)
                print(f"Server {server_config.name} verification result: {status}")
                client_name = server_config.client or "unknown"
                composite_key = f"{client_name}:{server_config.name}"
                results[composite_key] = status
                results[server_config.name] = status
            except Exception as e:
                client_name = server_config.client or "unknown"
                composite_key = f"{client_name}:{server_config.name}"
                results[composite_key] = "failed"
                results[server_config.name] = "failed"
                print(f"Verification error for {server_config.name}: {e}")

        success_count = sum(1 for status in results.values() if status == "success")  # type: ignore
        print(f"Final results: {results}")
        print(f"Success count: {success_count}")

        return VerificationResponse(
            success=success_count > 0,
            results=results,  # type: ignore
            message=f"Verified {success_count}/{len(request.servers)} servers successfully",
        )

    except Exception as e:
        return VerificationResponse(
            success=False,
            results={},  # type: ignore
            message=f"Verification failed: {str(e)}",
        )


@app.post("/oauth", response_model=OAuthResponse)  # noqa
async def authorize_oauth(request: OAuthRequest):
    """Authorize OAuth for a remote MCP server."""
    try:
        mcp_config = convert_from_server_config(request.server)
        success = authorize_server_oauth(mcp_config)

        return OAuthResponse(
            success=success,
            message="OAuth authorization completed" if success else "OAuth authorization failed",
        )

    except Exception as e:
        return OAuthResponse(success=False, message=f"OAuth authorization error: {str(e)}")


class SaveRequest(BaseModel):
    servers: list[ServerConfig]
    dry_run: bool = False


@app.post("/save", response_model=dict[str, Any])  # noqa
async def save_imported_servers_to_config(request: SaveRequest):
    """Save imported servers to Open Edison configuration."""
    try:
        mcp_servers = [convert_from_server_config(server) for server in request.servers]
        config_path = save_imported_servers(mcp_servers, dry_run=request.dry_run)

        return {
            "success": True,
            "message": f"Saved {len(request.servers)} servers to configuration",
            "config_path": str(config_path) if config_path else None,
        }

    except Exception as e:
        return {"success": False, "message": f"Failed to save servers: {str(e)}"}


@app.post("/export", response_model=ExportResponse)  # noqa
async def export_to_clients(request: ExportRequest):
    """Export Open Edison configuration to specified clients."""
    try:
        results = {}

        for client_name in request.clients:
            try:
                client = CLIENT(client_name)
                result = export_edison_to(
                    client,
                    url=request.url,
                    api_key=request.api_key,
                    server_name=request.server_name,
                    dry_run=request.dry_run,
                    force=request.force,
                    create_if_missing=request.create_if_missing,
                    selected_servers=request.selected_servers,
                )
                results[client_name] = {
                    "success": result.wrote_changes,
                    "backup_path": str(result.backup_path) if result.backup_path else None,
                    "target_path": str(result.target_path),
                }
            except Exception as e:
                results[client_name] = {"success": False, "error": str(e)}

        success_count = sum(
            1
            for result in results.values()  # type: ignore
            if isinstance(result, dict) and result.get("success", False)  # type: ignore
        )  # type: ignore

        return ExportResponse(
            success=success_count > 0,
            results=results,  # type: ignore
            message=f"Exported to {success_count}/{len(request.clients)} clients successfully",
        )

    except Exception as e:
        return ExportResponse(
            success=False,
            results={},  # type: ignore
            message=f"Export failed: {str(e)}",
        )


@app.post("/replace", response_model=ReplaceResponse)  # noqa
async def replace_mcp_servers(request: ReplaceRequest):
    """Replace existing MCP server configurations with Open Edison.

    This will:
    1. Backup existing MCP configurations
    2. Replace selected servers with Open Edison configuration
    3. Retain non-selected servers from original configuration
    4. Provide restore functionality
    """
    try:
        results = {}

        for client_name in request.clients:
            try:
                client = CLIENT(client_name.lower())
                log.debug(
                    f"Exporting Open Edison to {client_name} (selected servers: {request.selected_servers})"
                )
                result = export_edison_to(
                    client,
                    url=request.url,
                    api_key=request.api_key,
                    server_name=request.server_name,
                    dry_run=request.dry_run,
                    force=request.force,
                    create_if_missing=request.create_if_missing,
                    selected_servers=request.selected_servers,
                )
                results[client_name] = {
                    "success": result.wrote_changes,
                    "backup_path": str(result.backup_path) if result.backup_path else None,
                    "target_path": str(result.target_path),
                    "backed_up": result.backup_path is not None,
                }
            except Exception as e:
                results[client_name] = {"success": False, "error": str(e)}

        success_count = sum(
            1
            for result in results.values()  # type: ignore
            if isinstance(result, dict) and result.get("success", False)  # type: ignore
        )  # type: ignore

        backup_count = sum(
            1
            for result in results.values()  # type: ignore
            if isinstance(result, dict) and result.get("backed_up", False)  # type: ignore
        )  # type: ignore

        return ReplaceResponse(
            success=success_count > 0,
            results=results,  # type: ignore
            message=f"Replaced MCP servers in {success_count}/{len(request.clients)} clients successfully. {backup_count} configurations backed up.",
        )

    except Exception as e:
        return ReplaceResponse(
            success=False,
            results={},  # type: ignore
            message=f"Replace failed: {str(e)}",
        )


@app.get("/backups", response_model=BackupInfoResponse)  # noqa
async def get_backup_info():
    """Get information about available backups for all clients."""
    try:
        backups: dict[str, Any] = {}

        # Get detected clients and their paths
        detected_clients = detect_clients()

        for client in detected_clients:
            try:
                # Use the existing export functionality to get target paths
                result = export_edison_to(
                    client,
                    url="http://localhost:3000/mcp/",
                    api_key="dev-api-key-change-me",
                    server_name="open-edison",
                    dry_run=True,  # Don't actually export, just get paths
                    force=False,
                    create_if_missing=False,
                )

                target_path = result.target_path
                backup_path = result.backup_path

                backups[client.value] = {
                    "has_backup": backup_path is not None,
                    "backup_path": str(backup_path) if backup_path else None,
                    "target_path": str(target_path),
                }
            except Exception as e:
                backups[client.value] = {
                    "has_backup": False,
                    "backup_path": None,
                    "target_path": f"Error: {str(e)}",
                }

        return BackupInfoResponse(
            success=True,
            backups=backups,
            message=f"Found backup information for {len(backups)} clients",
        )

    except Exception as e:
        return BackupInfoResponse(
            success=False,
            backups={},
            message=f"Failed to get backup info: {str(e)}",
        )


class RestoreRequest(BaseModel):
    clients: list[str]
    server_name: str = "open-edison"
    dry_run: bool = False


@app.post("/restore")  # noqa
async def restore_client_configs(request: RestoreRequest) -> dict[str, Any]:
    """Restore original MCP configurations for specified clients."""
    try:
        results = {}

        for client_name in request.clients:
            try:
                client = CLIENT(client_name)
                result = restore_client(
                    client, server_name=request.server_name, dry_run=request.dry_run
                )
                results[client_name] = {
                    "success": getattr(result, "wrote_changes", False),
                    "restored_from_backup": str(getattr(result, "restored_from_backup", None))
                    if getattr(result, "restored_from_backup", None)
                    else None,
                    "removed_open_edison_only": getattr(result, "removed_open_edison_only", False),
                    "target_path": str(getattr(result, "target_path", "")),
                }
            except Exception as e:
                results[client_name] = {"success": False, "error": str(e)}

        success_count = sum(
            1
            for result in results.values()  # type: ignore
            if isinstance(result, dict) and result.get("success", False)  # type: ignore
        )  # type: ignore

        return {
            "success": success_count > 0,
            "results": results,  # type: ignore
            "message": f"Restore operations completed for {success_count}/{len(request.clients)} clients",
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Restore failed: {str(e)}",  # type: ignore
        }


@app.get("/config")  # noqa
async def get_current_config():
    """Get current Open Edison configuration."""
    try:
        config_dir = get_config_dir()
        config_path = config_dir / "config.json"

        if config_path.exists():
            with open(config_path) as f:
                config_data = json.load(f)
            return {"success": True, "config": config_data, "config_path": str(config_path)}
        return {"success": False, "message": "Configuration file not found"}

    except Exception as e:
        return {"success": False, "message": f"Failed to read configuration: {str(e)}"}


def main():
    """Run the API server."""
    import argparse

    parser = argparse.ArgumentParser(description="Open Edison Setup Wizard API Server")
    parser.add_argument("--host", default="localhost", help="Host to bind to")
    parser.add_argument("--port", type=int, default=3002, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")

    args = parser.parse_args()

    log.info(f"Starting Setup Wizard API server on {args.host}:{args.port}")

    # Pass the ASGI app object directly to avoid string import resolution in frozen builds
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
