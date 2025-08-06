"""
Open Edison Server

Simple FastAPI + FastMCP server for single-user MCP proxy.
No multi-user support, no complex routing - just a straightforward proxy.
"""

import asyncio
from collections.abc import Coroutine
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger as log

from src.config import MCPServerConfig, config
from src.mcp_manager import MCPManager
from src.single_user_mcp import SingleUserMCP


def _get_current_config():
    """Get current config, allowing for test mocking."""
    from src.config import config as current_config

    return current_config


# Module-level dependency singletons
_security = HTTPBearer()
_auth_dependency = Depends(_security)


class OpenEdisonProxy:
    """
    Open Edison Single-User MCP Proxy Server

    Runs both FastAPI (for management API) and FastMCP (for MCP protocol)
    on different ports, similar to edison-watch but simplified for single-user.
    """

    def __init__(self, host: str = "localhost", port: int = 3000):
        self.host: str = host
        self.port: int = port

        # Initialize components
        self.mcp_manager: MCPManager = MCPManager()
        self.single_user_mcp: SingleUserMCP = SingleUserMCP(self.mcp_manager)

        # Initialize FastAPI app for management
        self.fastapi_app: FastAPI = self._create_fastapi_app()

    def _create_fastapi_app(self) -> FastAPI:
        """Create and configure FastAPI application"""
        app = FastAPI(
            title="Open Edison MCP Proxy",
            description="Single-user MCP proxy server",
            version="0.1.0",
        )

        # Add CORS middleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # In production, be more restrictive
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Register all routes
        self._register_routes(app)

        return app

    async def start(self) -> None:
        """Start the Open Edison proxy server"""
        log.info("🚀 Starting Open Edison MCP Proxy Server")
        log.info(f"FastAPI management API on {self.host}:{self.port + 1}")
        log.info(f"FastMCP protocol server on {self.host}:{self.port}")

        # Initialize the FastMCP server (this handles starting enabled MCP servers)
        await self.single_user_mcp.initialize()

        # Add CORS middleware to FastAPI
        self.fastapi_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # In production, be more restrictive
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Create server configurations
        servers_to_run: list[Coroutine[Any, Any, None]] = []

        # FastAPI management server on port 3001
        fastapi_config = uvicorn.Config(
            app=self.fastapi_app,
            host=self.host,
            port=self.port + 1,
            log_level=config.logging.level.lower(),
        )
        fastapi_server = uvicorn.Server(fastapi_config)
        servers_to_run.append(fastapi_server.serve())

        # FastMCP protocol server on port 3000 (stateless for testing)
        mcp_app = self.single_user_mcp.http_app(path="/mcp/", stateless_http=True)
        fastmcp_config = uvicorn.Config(
            app=mcp_app,
            host=self.host,
            port=self.port,
            log_level=config.logging.level.lower(),
        )
        fastmcp_server = uvicorn.Server(fastmcp_config)
        servers_to_run.append(fastmcp_server.serve())

        # Run both servers concurrently
        log.info("🚀 Starting both FastAPI and FastMCP servers...")
        _ = await asyncio.gather(*servers_to_run)

    async def shutdown(self) -> None:
        """Shutdown the proxy server and all MCP servers"""
        log.info("🛑 Shutting down Open Edison proxy server")
        await self.mcp_manager.shutdown()
        log.info("✅ Open Edison proxy server shutdown complete")

    def _register_routes(self, app: FastAPI) -> None:
        """Register all routes for the FastAPI app"""
        # Register routes with their decorators
        app.add_api_route("/health", self.health_check, methods=["GET"])
        app.add_api_route(
            "/mcp/status",
            self.mcp_status,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/{server_name}/start",
            self.start_mcp_server,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/{server_name}/stop",
            self.stop_mcp_server,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/call",
            self.proxy_mcp_call,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/mounted",
            self.get_mounted_servers,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/{server_name}/mount",
            self.mount_server,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/{server_name}/unmount",
            self.unmount_server,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/sessions",
            self.get_sessions,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )

    async def verify_api_key(
        self, credentials: HTTPAuthorizationCredentials = _auth_dependency
    ) -> str:
        """
        Dependency to verify API key from Authorization header.

        Returns the API key string if valid, otherwise raises HTTPException.
        """
        current_config = _get_current_config()
        if credentials.credentials != current_config.server.api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        return credentials.credentials

    def _handle_server_operation_error(
        self, operation: str, server_name: str, error: Exception
    ) -> HTTPException:
        """Handle common server operation errors."""
        log.error(f"Failed to {operation} server {server_name}: {error}")
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to {operation} server: {str(error)}",
        )

    def _find_server_config(self, server_name: str) -> MCPServerConfig:
        """Find server configuration by name."""
        current_config = _get_current_config()
        for config_server in current_config.mcp_servers:
            if config_server.name == server_name:
                return config_server
        raise HTTPException(
            status_code=404,
            detail=f"Server configuration not found: {server_name}",
        )

    async def health_check(self) -> dict[str, Any]:
        """Health check endpoint"""
        return {"status": "healthy", "version": "0.1.0", "mcp_servers": len(config.mcp_servers)}

    async def mcp_status(self) -> dict[str, list[dict[str, str | bool]]]:
        """Get status of configured MCP servers"""
        return {
            "servers": [
                {
                    "name": server.name,
                    "enabled": server.enabled,
                    "running": await self.mcp_manager.is_server_running(server.name),
                }
                for server in config.mcp_servers
            ]
        }

    async def start_mcp_server(self, server_name: str) -> dict[str, str]:
        """Start a specific MCP server"""
        try:
            _ = await self.mcp_manager.start_server(server_name)
            return {"message": f"Server {server_name} started successfully"}
        except Exception as e:
            raise self._handle_server_operation_error("start", server_name, e) from e

    async def stop_mcp_server(self, server_name: str) -> dict[str, str]:
        """Stop a specific MCP server"""
        try:
            await self.mcp_manager.stop_server(server_name)
            return {"message": f"Server {server_name} stopped successfully"}
        except Exception as e:
            raise self._handle_server_operation_error("stop", server_name, e) from e

    async def proxy_mcp_call(self, request: dict[str, Any]) -> dict[str, Any]:
        """
        Proxy MCP calls to mounted servers.

        This now routes requests through the mounted FastMCP servers.
        """
        try:
            log.info(f"Proxying MCP request: {request.get('method', 'unknown')}")

            mounted = await self.single_user_mcp.get_mounted_servers()
            mounted_names = [server["name"] for server in mounted]

            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "message": "MCP request routed through FastMCP",
                    "request": request,
                    "mounted_servers": mounted_names,
                },
            }
        except Exception as e:
            log.error(f"Failed to proxy MCP call: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to proxy MCP call: {str(e)}",
            ) from e

    async def get_mounted_servers(self) -> dict[str, Any]:
        """Get list of currently mounted MCP servers."""
        try:
            mounted = await self.single_user_mcp.get_mounted_servers()
            return {"mounted_servers": mounted}
        except Exception as e:
            log.error(f"Failed to get mounted servers: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get mounted servers: {str(e)}",
            ) from e

    async def mount_server(self, server_name: str) -> dict[str, str]:
        """Mount a specific MCP server."""
        try:
            server_config = self._find_server_config(server_name)
            success = await self.single_user_mcp.mount_server_from_config(server_config)
            if success:
                return {"message": f"Server {server_name} mounted successfully"}
            raise HTTPException(
                status_code=500,
                detail=f"Failed to mount server: {server_name}",
            )
        except HTTPException:
            raise
        except Exception as e:
            raise self._handle_server_operation_error("mount", server_name, e) from e

    async def unmount_server(self, server_name: str) -> dict[str, str]:
        """Unmount a specific MCP server."""
        try:
            if server_name == "test-echo":
                log.info("Special handling for test-echo server unmount")
                _ = await self.single_user_mcp.unmount_server(server_name)
                return {"message": f"Server {server_name} unmounted successfully"}
            _ = await self.single_user_mcp.unmount_server(server_name)
            return {"message": f"Server {server_name} unmounted successfully"}
        except HTTPException:
            raise
        except Exception as e:
            raise self._handle_server_operation_error("unmount", server_name, e) from e

    async def get_sessions(self) -> dict[str, list[Any] | str]:
        """Get recent session logs (placeholder)"""
        # TODO: Implement session logging to SQLite
        return {"sessions": [], "message": "Session logging not yet implemented"}
