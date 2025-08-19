"""
Open Edison Server

Simple FastAPI + FastMCP server for single-user MCP proxy.
No multi-user support, no complex routing - just a straightforward proxy.
"""

import asyncio
import json
import traceback
from collections.abc import Awaitable, Callable, Coroutine
from pathlib import Path
from typing import Any, cast

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastmcp import FastMCP
from loguru import logger as log
from pydantic import BaseModel, Field

from src.config import MCPServerConfig, config
from src.config import get_config_dir as _get_cfg_dir  # type: ignore[attr-defined]
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
        self.single_user_mcp: SingleUserMCP = SingleUserMCP()

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
            """
            Resolve a JSON config file path consistently with src.config defaults.

            Precedence for reads and writes:
            1) Config dir (OPEN_EDISON_CONFIG_DIR or platform default) — if file exists
            2) Repository/package defaults next to src/ — and bootstrap a copy into the config dir if missing
            3) Config dir target path (even if not yet created) as last resort
            """
            # 1) Config directory (preferred)
            try:
                base = _get_cfg_dir()
            except Exception:
                base = Path.cwd()
            target = base / filename
            if target.exists():
                return target

            # 2) Repository/package defaults next to src/
            repo_candidate = Path(__file__).parent.parent / filename
            if repo_candidate.exists():
                # Bootstrap a copy into config dir when possible
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(repo_candidate.read_text(encoding="utf-8"), encoding="utf-8")
                except Exception:
                    pass
                return target if target.exists() else repo_candidate

            # 3) Fall back to config dir path (will be created on save)
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
                source: str = "unknown"
                if isinstance(name, str) and name in allowed_json_files:
                    target = _resolve_json_path(name)
                    source = f"name={name}"
                elif isinstance(path_val, str):
                    # Normalize path but restrict to allowed filenames, then resolve like reads
                    candidate = Path(path_val)
                    filename = candidate.name
                    if filename not in allowed_json_files:
                        raise ValueError("filename not allowed")
                    target = _resolve_json_path(filename)
                    source = f"path={path_val} -> filename={filename}"
                else:
                    raise ValueError("invalid target file")

                log.debug(
                    f"Saving JSON config ({source}), resolved target: {target} (bytes={len(content.encode('utf-8'))})"
                )

                _ = json.loads(content or "{}")
                target.write_text(content or "{}", encoding="utf-8")
                log.debug(f"Saved JSON config to {target}")
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

    def _build_backend_config_top(
        self, server_name: str, body: "OpenEdisonProxy._ValidateRequest"
    ) -> dict[str, Any]:
        backend_entry: dict[str, Any] = {
            "command": body.command,
            "args": body.args,
            "env": body.env or {},
        }
        if body.roots:
            backend_entry["roots"] = body.roots
        return {"mcpServers": {server_name: backend_entry}}

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

    def _register_routes(self, app: FastAPI) -> None:
        """Register all routes for the FastAPI app"""
        # Register routes with their decorators
        app.add_api_route("/health", self.health_check, methods=["GET"])
        app.add_api_route(
            "/mcp/status",
            self.mcp_status,
            methods=["GET"],
        )
        app.add_api_route(
            "/mcp/validate",
            self.validate_mcp_server,
            methods=["POST"],
            # Intentionally no auth required for validation for now
        )
        app.add_api_route(
            "/mcp/mounted",
            self.get_mounted_servers,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/reinitialize",
            self.reinitialize_mcp_servers,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        # Public sessions endpoint (no auth) for simple local dashboard
        app.add_api_route(
            "/sessions",
            self.get_sessions,
            methods=["GET"],
        )
        # Cache invalidation endpoint (no auth required - allowed to fail)
        app.add_api_route(
            "/api/clear-caches",
            self.clear_caches,
            methods=["POST"],
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

    async def mcp_status(self) -> dict[str, list[dict[str, Any]]]:
        """Get status of configured MCP servers (auth required)."""
        return {
            "servers": [
                {
                    "name": server.name,
                    "enabled": server.enabled,
                }
                for server in config.mcp_servers
            ]
        }

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

    async def reinitialize_mcp_servers(self) -> dict[str, Any]:
        """Reinitialize all MCP servers by creating a fresh instance and reloading config."""
        old_mcp = None
        try:
            log.info("🔄 Reinitializing MCP servers via API endpoint")

            # Reload configuration from disk
            log.info("Reloading configuration from disk")
            from src.config import Config

            fresh_config = Config.load()
            log.info("✅ Configuration reloaded from disk")

            # Create a completely new SingleUserMCP instance to ensure clean state
            old_mcp = self.single_user_mcp
            self.single_user_mcp = SingleUserMCP()

            # Initialize the new instance with fresh config
            await self.single_user_mcp.initialize(fresh_config)

            # Get final status
            final_mounted = await self.single_user_mcp.get_mounted_servers()

            result = {
                "status": "success",
                "message": "MCP servers reinitialized successfully",
                "final_mounted_servers": [server["name"] for server in final_mounted],
                "total_final_mounted": len(final_mounted),
            }

            log.info("✅ MCP servers reinitialized successfully via API")
            return result

        except Exception as e:
            log.error(f"❌ Failed to reinitialize MCP servers: {e}")
            # Restore the old instance on failure
            if old_mcp is not None:
                self.single_user_mcp = old_mcp
            raise HTTPException(
                status_code=500,
                detail=f"Failed to reinitialize MCP servers: {str(e)}",
            ) from e

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

    async def clear_caches(self) -> dict[str, str]:
        """Clear all permission caches to force reload from configuration files."""
        try:
            from src.middleware.data_access_tracker import clear_all_permissions_caches

            log.info("🔄 Clearing all permission caches via API endpoint")
            clear_all_permissions_caches()
            log.info("✅ All permission caches cleared successfully")

            return {"status": "success", "message": "All permission caches cleared"}
        except Exception as e:
            log.error(f"❌ Failed to clear permission caches: {e}")
            # Don't raise HTTPException - allow to fail gracefully as requested
            return {"status": "error", "message": f"Failed to clear caches: {str(e)}"}

    # ---- MCP validation ----
    class _ValidateRequest(BaseModel):
        name: str | None = Field(None, description="Optional server name label")
        command: str = Field(..., description="Executable to run, e.g. 'npx' or 'uvx'")
        args: list[str] = Field(default_factory=list, description="Arguments to the command")
        env: dict[str, str] | None = Field(
            default=None,
            description="Environment variables for the subprocess (values should already exist)",
        )
        roots: list[str] | None = Field(
            default=None, description="Optional allowed roots for the MCP server"
        )
        timeout_s: float | None = Field(20.0, description="Overall timeout for validation")

    async def validate_mcp_server(self, body: _ValidateRequest) -> dict[str, Any]:  # noqa: C901
        """
        Validate an MCP server by launching it via FastMCP and listing capabilities.

        Returns tools, resources, and prompts if successful.
        """

        server_name = body.name or "validation"
        backend_cfg = self._build_backend_config_top(server_name, body)

        log.info(
            f"Validating MCP server command for '{server_name}': {body.command} {' '.join(body.args)}"
        )

        server: FastMCP[Any] | None = None
        try:
            # Guard for template entries with no command configured
            if not body.command or not body.command.strip():
                return {
                    "valid": False,
                    "error": "No command configured (template entry)",
                    "server": {
                        "name": server_name,
                        "command": body.command,
                        "args": body.args,
                        "has_roots": bool(body.roots),
                    },
                }

            server = FastMCP.as_proxy(
                backend=backend_cfg, name=f"open-edison-validate-{server_name}"
            )
            tools, resources, prompts = await self._list_all_capabilities(server, body)

            return {
                "valid": True,
                "server": {
                    "name": server_name,
                    "command": body.command,
                    "args": body.args,
                    "has_roots": bool(body.roots),
                },
                "tools": [self._safe_tool(t, prefix=server_name) for t in tools],
                "resources": [self._safe_resource(r) for r in resources],
                "prompts": [self._safe_prompt(p, prefix=server_name) for p in prompts],
            }
        except TimeoutError as te:  # noqa: PERF203
            log.error(f"MCP validation timed out: {te}\n{traceback.format_exc()}")
            return {
                "valid": False,
                "error": "Validation timed out",
                "server": {
                    "name": server_name,
                    "command": body.command,
                    "args": body.args,
                    "has_roots": bool(body.roots),
                },
            }
        except Exception as e:  # noqa: BLE001
            log.error(f"MCP validation failed: {e}\n{traceback.format_exc()}")
            return {
                "valid": False,
                "error": str(e),
                "server": {
                    "name": server_name,
                    "command": body.command,
                    "args": body.args,
                    "has_roots": bool(body.roots),
                },
            }
        finally:
            # Best-effort cleanup if FastMCP exposes a shutdown/close
            try:
                if isinstance(server, FastMCP):
                    result = server.shutdown()  # type: ignore[attr-defined]
                    # If it returns an awaitable, await it
                    if isinstance(result, Awaitable):
                        await result  # type: ignore[func-returns-value]
            except Exception as cleanup_err:  # noqa: BLE001
                log.debug(f"Validator cleanup skipped/failed: {cleanup_err}")

    def _build_backend_config(
        self, server_name: str, body: "OpenEdisonProxy._ValidateRequest"
    ) -> dict[str, Any]:
        backend_entry: dict[str, Any] = {
            "command": body.command,
            "args": body.args,
            "env": body.env or {},
        }
        if body.roots:
            backend_entry["roots"] = body.roots
        return {"mcpServers": {server_name: backend_entry}}

    async def _list_all_capabilities(
        self, server: FastMCP[Any], body: "OpenEdisonProxy._ValidateRequest"
    ) -> tuple[list[Any], list[Any], list[Any]]:
        s: Any = server

        async def _call_list(kind: str) -> list[Any]:
            # Prefer public list_*; fallback to _list_* for proxies that expose private methods
            for attr in (f"list_{kind}", f"_list_{kind}"):
                if hasattr(s, attr):
                    method = getattr(s, attr)
                    return await method()
            raise AttributeError(f"Proxy does not expose list method for {kind}")

        async def list_all() -> tuple[list[Any], list[Any], list[Any]]:
            tools = await _call_list("tools")
            resources = await _call_list("resources")
            prompts = await _call_list("prompts")
            return tools, resources, prompts

        timeout = body.timeout_s if isinstance(body.timeout_s, (int | float)) else 20.0
        return await asyncio.wait_for(list_all(), timeout=timeout)

    def _safe_tool(self, t: Any, prefix: str) -> dict[str, Any]:
        name = getattr(t, "name", None)
        description = getattr(t, "description", None)
        return {
            "name": prefix + "_" + str(name) if name is not None else "",
            "description": description,
        }

    def _safe_resource(self, r: Any) -> dict[str, Any]:
        uri = getattr(r, "uri", None)
        try:
            uri_str = str(uri) if uri is not None else ""
        except Exception:
            uri_str = ""
        description = getattr(r, "description", None)
        return {"uri": uri_str, "description": description}

    def _safe_prompt(self, p: Any, prefix: str) -> dict[str, Any]:
        name = getattr(p, "name", None)
        description = getattr(p, "description", None)
        return {
            "name": prefix + "_" + str(name) if name is not None else "",
            "description": description,
        }
