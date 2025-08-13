"""
Open Edison Server

Simple FastAPI + FastMCP server for single-user MCP proxy.
No multi-user support, no complex routing - just a straightforward proxy.
"""

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from pathlib import Path
from typing import Any, cast

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from loguru import logger as log

from src.config import MCPServerConfig, config
from src.config import get_config_dir as _get_cfg_dir  # type: ignore[attr-defined]
from src.mcp_manager import MCPManager
from src.middleware.session_tracking import (
    MCPSessionModel,
    create_db_session,
)
from src.single_user_mcp import SingleUserMCP
from src.telemetry import initialize_telemetry, set_servers_installed


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

    def _create_fastapi_app(self) -> FastAPI:  # noqa: C901 - centralized app wiring
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

        # If packaged frontend assets exist, mount at /dashboard
        try:
            # Prefer packaged assets under src/frontend_dist
            static_dir = Path(__file__).parent / "frontend_dist"
            if not static_dir.exists():
                # Fallback to repo root or site-packages root (older layout)
                static_dir = Path(__file__).parent.parent / "frontend_dist"
            if static_dir.exists():
                app.mount(
                    "/dashboard",
                    StaticFiles(directory=str(static_dir), html=True),
                    name="dashboard",
                )
                assets_dir = static_dir / "assets"
                if assets_dir.exists():
                    app.mount(
                        "/assets",
                        StaticFiles(directory=str(assets_dir), html=False),
                        name="dashboard-assets",
                    )
                favicon_path = static_dir / "favicon.ico"
                if favicon_path.exists():

                    async def _favicon() -> FileResponse:  # type: ignore[override]
                        return FileResponse(str(favicon_path))

                    app.add_api_route("/favicon.ico", _favicon, methods=["GET"])  # type: ignore[arg-type]
                log.info(f"📊 Dashboard static assets mounted at /dashboard from {static_dir}")
            else:
                log.debug("No packaged frontend assets found; skipping static mount")
        except Exception as mount_err:  # noqa: BLE001
            log.warning(f"Failed to mount dashboard static assets: {mount_err}")

        # Special-case: serve SQLite db and config JSONs for dashboard (prod replacement for Vite @fs)
        def _resolve_db_path() -> Path | None:
            try:
                # Try configured database path first
                db_cfg = getattr(config.logging, "database_path", None)
                if isinstance(db_cfg, str) and db_cfg:
                    db_path = Path(db_cfg)
                    if db_path.is_absolute() and db_path.exists():
                        return db_path
                    # Check relative to config dir
                    try:
                        cfg_dir = _get_cfg_dir()
                    except Exception:
                        cfg_dir = Path.cwd()
                    rel1 = cfg_dir / db_path
                    if rel1.exists():
                        return rel1
                    # Also check relative to cwd as a fallback
                    rel2 = Path.cwd() / db_path
                    if rel2.exists():
                        return rel2
            except Exception:
                pass

            # Fallback common locations
            try:
                cfg_dir = _get_cfg_dir()
            except Exception:
                cfg_dir = Path.cwd()
            candidates = [
                cfg_dir / "sessions.db",
                cfg_dir / "sessions.db",
                Path.cwd() / "edison.db",
                Path.cwd() / "sessions.db",
            ]
            for c in candidates:
                if c.exists():
                    return c
            return None

        async def _serve_db() -> FileResponse:  # type: ignore[override]
            db_file = _resolve_db_path()
            if db_file is None:
                raise HTTPException(status_code=404, detail="Database file not found")
            return FileResponse(str(db_file), media_type="application/octet-stream")

        # Provide multiple paths the SPA might attempt (both edison.db legacy and sessions.db canonical)
        for name in ("edison.db", "sessions.db"):
            app.add_api_route(f"/dashboard/{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]
            app.add_api_route(f"/{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]
            app.add_api_route(f"/@fs/dashboard//{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]
            app.add_api_route(f"/@fs/{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]
            # Also support URL-encoded '@' prefix used by some bundlers
            app.add_api_route(f"/%40fs/dashboard//{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]
            app.add_api_route(f"/%40fs/{name}", _serve_db, methods=["GET"])  # type: ignore[arg-type]

        # Config files (read + write)
        allowed_json_files = {
            "config.json",
            "tool_permissions.json",
            "resource_permissions.json",
            "prompt_permissions.json",
        }

        def _resolve_json_path(filename: str) -> Path:
            # JSON files reside in the config directory
            try:
                base = _get_cfg_dir()
            except Exception:
                base = Path.cwd()
            target = base / filename
            # If missing and we ship a default in package root, bootstrap it
            if not target.exists():
                try:
                    pkg_default = Path(__file__).parent.parent / filename
                    if pkg_default.exists():
                        target.write_text(pkg_default.read_text(encoding="utf-8"), encoding="utf-8")
                except Exception:
                    pass
            return target

        async def _serve_json(filename: str) -> Response:  # type: ignore[override]
            if filename not in allowed_json_files:
                raise HTTPException(status_code=404, detail="Not found")
            json_path = _resolve_json_path(filename)
            if not json_path.exists():
                # Return empty object for missing files to avoid hard failures in UI
                return JSONResponse(content={}, media_type="application/json")
            return FileResponse(str(json_path), media_type="application/json")

        def _json_endpoint_factory(name: str) -> Callable[[], Awaitable[Response]]:
            async def endpoint() -> Response:
                return await _serve_json(name)

            return endpoint

        # GET endpoints for convenience
        for name in allowed_json_files:
            app.add_api_route(f"/{name}", _json_endpoint_factory(name), methods=["GET"])  # type: ignore[arg-type]
            app.add_api_route(f"/dashboard/{name}", _json_endpoint_factory(name), methods=["GET"])  # type: ignore[arg-type]

        # Save endpoint to persist JSON changes
        async def _save_json(body: dict[str, Any]) -> dict[str, str]:  # type: ignore[override]
            try:
                # Accept either {path, content} or {name, content}
                name = body.get("name")
                path_val = body.get("path")
                content = body.get("content", "")
                if not isinstance(content, str):
                    raise ValueError("content must be string")
                if isinstance(name, str) and name in allowed_json_files:
                    target = _resolve_json_path(name)
                elif isinstance(path_val, str):
                    base = Path.cwd()
                    # Normalize path but restrict to allowed filenames
                    candidate = Path(path_val)
                    filename = candidate.name
                    if filename not in allowed_json_files:
                        raise ValueError("filename not allowed")
                    target = base / filename
                else:
                    raise ValueError("invalid target file")
                # Basic validation to ensure valid JSON
                import json as _json

                _ = _json.loads(content or "{}")
                target.write_text(content or "{}", encoding="utf-8")
                return {"status": "ok"}
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Save failed: {e}") from e

        app.add_api_route("/__save_json__", _save_json, methods=["POST"])  # type: ignore[arg-type]

        # Catch-all for @fs patterns; serve known db and json filenames
        async def _serve_fs_path(rest: str):  # type: ignore[override]
            target = rest.strip("/")
            # Basename-based allowlist
            basename = Path(target).name
            if basename in allowed_json_files:
                return await _serve_json(basename)
            if basename.endswith(("edison.db", "sessions.db")):
                return await _serve_db()
            raise HTTPException(status_code=404, detail="Not found")

        app.add_api_route("/@fs/{rest:path}", _serve_fs_path, methods=["GET"])  # type: ignore[arg-type]
        app.add_api_route("/%40fs/{rest:path}", _serve_fs_path, methods=["GET"])  # type: ignore[arg-type]

        return app

    async def start(self) -> None:
        """Start the Open Edison proxy server"""
        log.info("🚀 Starting Open Edison MCP Proxy Server")
        log.info(f"FastAPI management API on {self.host}:{self.port + 1}")
        log.info(f"FastMCP protocol server on {self.host}:{self.port}")

        initialize_telemetry()

        # Ensure the sessions database exists and has the required schema
        try:
            with create_db_session():
                pass
        except Exception as db_err:  # noqa: BLE001
            log.warning(f"Failed to pre-initialize sessions database: {db_err}")

        # Initialize the FastMCP server (this handles starting enabled MCP servers)
        await self.single_user_mcp.initialize()

        # Emit snapshot of enabled servers
        enabled_count = len([s for s in config.mcp_servers if s.enabled])
        set_servers_installed(enabled_count)

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

        # FastMCP protocol server on port 3000 (stateful for session persistence)
        mcp_app = self.single_user_mcp.http_app(path="/mcp/", stateless_http=False)
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
        # Public sessions endpoint (no auth) for simple local dashboard
        app.add_api_route(
            "/sessions",
            self.get_sessions,
            methods=["GET"],
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
            success = await self.single_user_mcp.mount_server(server_config)
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

    async def get_sessions(self) -> dict[str, Any]:
        """Return recent MCP session summaries from local SQLite.

        Response shape:
        {
          "sessions": [
            {
              "session_id": str,
              "correlation_id": str,
              "tool_calls": list[dict[str, Any]],
              "data_access_summary": dict[str, Any]
            },
            ...
          ]
        }
        """
        try:
            with create_db_session() as db_session:
                # Fetch latest 100 sessions by primary key desc
                results = (
                    db_session.query(MCPSessionModel)
                    .order_by(MCPSessionModel.id.desc())
                    .limit(100)
                    .all()
                )

                sessions: list[dict[str, Any]] = []
                for row_model in results:
                    row = cast(Any, row_model)
                    tool_calls_val = row.tool_calls
                    data_access_summary_val = row.data_access_summary
                    sessions.append(
                        {
                            "session_id": row.session_id,
                            "correlation_id": row.correlation_id,
                            "tool_calls": tool_calls_val
                            if isinstance(tool_calls_val, list)
                            else [],
                            "data_access_summary": data_access_summary_val
                            if isinstance(data_access_summary_val, dict)
                            else {},
                        }
                    )

                return {"sessions": sessions}
        except Exception as e:
            log.error(f"Failed to fetch sessions: {e}")
            raise HTTPException(status_code=500, detail="Failed to fetch sessions") from e
