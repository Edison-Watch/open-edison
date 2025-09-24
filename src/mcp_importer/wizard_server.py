#!/usr/bin/env python3
"""
HTTP API server for setup wizard functionality.
Provides REST endpoints for the Electron app to interact with MCP import/export operations.
"""

import json
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
from src.mcp_importer.parsers import deduplicate_by_name


# Pydantic models for API requests/responses
class ServerConfig(BaseModel):
    name: str
    command: str
    args: list[str]
    env: dict[str, str]
    enabled: bool
    roots: list[str] | None = None


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


class ExportResponse(BaseModel):
    success: bool
    results: dict[str, Any]
    message: str


class ClientDetectionResponse(BaseModel):
    success: bool
    clients: list[str]
    message: str


class VerificationRequest(BaseModel):
    servers: list[ServerConfig]


class VerificationResponse(BaseModel):
    success: bool
    results: dict[str, bool]  # server_name -> verification_result
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


@app.options("/{path:path}")
async def options_handler(path: str):
    """Handle CORS preflight requests."""
    return {"message": "OK"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "setup-wizard-api"}


@app.get("/clients", response_model=ClientDetectionResponse)
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


@app.post("/import", response_model=ImportResponse)
async def import_mcp_servers(request: ImportRequest):
    """Import MCP servers from specified clients."""
    try:
        all_servers = []
        errors = []

        for client_name in request.clients:
            try:
                # Convert string to CLIENT enum
                client = CLIENT(client_name)
                servers = import_from(client)
                all_servers.extend(servers)  # type: ignore
            except ValueError:
                errors.append(f"Unknown client: {client_name}")  # type: ignore
            except Exception as e:
                errors.append(f"Error importing from {client_name}: {str(e)}")  # type: ignore

        # Deduplicate servers
        all_servers = deduplicate_by_name(all_servers)  # type: ignore

        # Convert to API format
        server_configs: list[ServerConfig] = [
            convert_to_server_config(server) for server in all_servers
        ]

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


@app.post("/verify", response_model=VerificationResponse)
async def verify_servers(request: VerificationRequest):
    """Verify MCP server configurations."""
    try:
        results = {}

        for server_config in request.servers:
            try:
                mcp_config = convert_from_server_config(server_config)
                is_valid = verify_mcp_server(mcp_config)
                results[server_config.name] = is_valid
            except Exception as e:
                results[server_config.name] = False
                print(f"Verification error for {server_config.name}: {e}")

        success_count = sum(1 for valid in results.values() if valid is True)  # type: ignore

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


@app.post("/oauth", response_model=OAuthResponse)
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

@app.post("/save", response_model=dict[str, Any])
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


@app.post("/export", response_model=ExportResponse)
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
            for result in results.values() # type: ignore
            if isinstance(result, dict) and result.get("success", False) # type: ignore
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


@app.post("/restore")
async def restore_client_configs(
    clients: list[str], server_name: str = "open-edison", dry_run: bool = False
) -> dict[str, Any]:
    """Restore original MCP configurations for specified clients."""
    try:
        results = {}

        for client_name in clients:
            try:
                client = CLIENT(client_name)
                result = restore_client(client, server_name=server_name, dry_run=dry_run)
                results[client_name] = {
                    "success": getattr(result, "restored", False),
                    "backup_path": str(getattr(result, "backup_path", None))
                    if getattr(result, "backup_path", None)
                    else None,
                    "message": getattr(result, "message", "Restore completed"),
                }
            except Exception as e:
                results[client_name] = {"success": False, "error": str(e)}

        return {
            "success": True,
            "results": results,  # type: ignore
            "message": f"Restore operations completed for {len(clients)} clients",
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Restore failed: {str(e)}",  # type: ignore
        }


@app.get("/config")
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

    print(f"Starting Setup Wizard API server on {args.host}:{args.port}")
    print("Available endpoints:")
    print("  GET  /health - Health check")
    print("  GET  /clients - Detect available MCP clients")
    print("  POST /import - Import MCP servers")
    print("  POST /verify - Verify server configurations")
    print("  POST /oauth - Authorize OAuth for remote servers")
    print("  POST /save - Save imported servers to config")
    print("  POST /export - Export to MCP clients")
    print("  POST /restore - Restore client configurations")
    print("  GET  /config - Get current configuration")

    uvicorn.run(
        "src.mcp_importer.wizard_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
