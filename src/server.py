"""
Open Edison MCP Proxy Server
Main server entrypoint for FastAPI and FastMCP integration.
See README for usage and configuration details.
"""

import asyncio
import json
import signal
import traceback
from collections.abc import Awaitable, Callable, Coroutine
from contextlib import suppress
from pathlib import Path
from typing import Any, Literal, cast

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastmcp import Client as FastMCPClient
from fastmcp import FastMCP
from loguru import logger as log
from pydantic import BaseModel, Field

from src import events
from src.config import Config, MCPServerConfig, clear_json_file_cache, get_config_json_path
from src.config import get_config_dir as _get_cfg_dir  # type: ignore[attr-defined]
from src.mcp_stdio_capture import (
    install_stdio_client_stderr_capture as _install_stdio_capture,
)
from src.middleware.session_tracking import (
    MCPSessionModel,
    create_db_session,
)
from src.oauth_manager import OAuthStatus, get_oauth_manager
from src.oauth_override import OpenEdisonOAuth
from src.permissions import Permissions
from src.single_user_mcp import SingleUserMCP
from src.telemetry import initialize_telemetry, set_servers_installed

# Module-level dependency singletons
_security = HTTPBearer()
_auth_dependency = Depends(_security)


_install_stdio_capture()


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
            primary_candidate = Path(__file__).parent / "frontend_dist"
            secondary_candidate = Path(__file__).parent.parent / "frontend_dist"
            log.trace(
                "Checking dashboard assets candidates: primary={}, exists={}, secondary={}, exists={}",
                primary_candidate,
                primary_candidate.exists(),
                secondary_candidate,
                secondary_candidate.exists(),
            )
            static_dir = primary_candidate if primary_candidate.exists() else secondary_candidate
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
                # Serve service worker at root path for registration at /sw.js
                sw_path = static_dir / "sw.js"
                if sw_path.exists():

                    async def _sw() -> FileResponse:  # type: ignore[override]
                        # Service workers must be served from the origin root scope
                        return FileResponse(str(sw_path), media_type="application/javascript")

                    app.add_api_route("/sw.js", _sw, methods=["GET"])  # type: ignore[arg-type]
                favicon_path = static_dir / "favicon.ico"
                if favicon_path.exists():

                    async def _favicon() -> FileResponse:  # type: ignore[override]
                        return FileResponse(str(favicon_path))

                    app.add_api_route("/favicon.ico", _favicon, methods=["GET"])  # type: ignore[arg-type]
                log.info(f"📊 Dashboard static assets mounted at /dashboard from {static_dir}")
            else:
                # If running from an installed package (no repository indicators), fail fast.
                # If running from repository source (pyproject present alongside src/), skip mount.
                cwd = Path.cwd()
                repo_root_candidate = Path(__file__).parent.parent / "pyproject.toml"
                if not repo_root_candidate.exists():
                    msg = (
                        "Packaged dashboard assets not found. Expected at one of: "
                        f"{primary_candidate} or {secondary_candidate}. "
                        f"cwd={cwd}, __file__={Path(__file__).resolve()}"
                    )
                    log.error(msg)
                    raise RuntimeError(msg)
                log.debug(
                    "Repository source detected ({} present). Skipping dashboard mount.",
                    repo_root_candidate,
                )
        except Exception as mount_err:  # noqa: BLE001
            log.error(f"Failed to mount dashboard static assets: {mount_err}")
            raise

        # Special-case: serve SQLite db and config JSONs for dashboard (prod replacement for Vite @fs)
        def _resolve_db_path() -> Path:
            # Try configured database path first
            db_cfg = Config().logging.database_path
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

            raise FileNotFoundError(f"Database file not found at {db_path}")

        async def _serve_db() -> FileResponse:  # type: ignore[override]
            db_file = _resolve_db_path()
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
                # Bootstrap a copy into config dir when possible (best effort)
                with suppress(Exception):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(repo_candidate.read_text(encoding="utf-8"), encoding="utf-8")
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

                # Clear cache for the config file, if it was config.json
                if name == "config.json":
                    clear_json_file_cache()
                elif name in (
                    "tool_permissions.json",
                    "resource_permissions.json",
                    "prompt_permissions.json",
                ):
                    Permissions.clear_permissions_file_cache()

                return {"status": "ok"}
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Save failed: {e}") from e

        app.add_api_route("/__save_json__", _save_json, methods=["POST"])  # type: ignore[arg-type]

        # SSE events endpoint
        async def _events() -> StreamingResponse:  # type: ignore[override]
            queue = await events.subscribe()
            return StreamingResponse(
                events.sse_stream(queue),
                media_type="text/event-stream",
            )

        app.add_api_route("/events", _events, methods=["GET"])  # type: ignore[arg-type]

        # Approval endpoint to allow an item for the rest of the session
        class _ApprovalBody(BaseModel):
            session_id: str
            kind: Literal["tool", "resource", "prompt"]
            name: str

        async def _approve(body: _ApprovalBody) -> dict[str, Any]:  # type: ignore[override]
            try:
                # Mark approval once; no persistent overrides
                await events.approve_once(body.session_id, body.kind, body.name)

                # Notify listeners (best effort, log failure)
                events.fire_and_forget(
                    {
                        "type": "mcp_approved_once",
                        "session_id": body.session_id,
                        "kind": body.kind,
                        "name": body.name,
                    }
                )

                return {"status": "ok"}
            except HTTPException:
                raise
            except Exception as e:  # noqa: BLE001
                log.error(f"Approval failed: {e}")
                raise HTTPException(status_code=500, detail="Failed to approve item") from e

        app.add_api_route("/api/approve", _approve, methods=["POST"])  # type: ignore[arg-type]

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

        # Redirect root to dashboard
        async def _root_redirect() -> RedirectResponse:  # type: ignore[override]
            return RedirectResponse(url="/dashboard")

        app.add_api_route("/", _root_redirect, methods=["GET"])  # type: ignore[arg-type]

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

        # Print location of config
        log.info(f"Config file location: {get_config_json_path()}")

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
        enabled_count = len([s for s in Config().mcp_servers if s.enabled])
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
            log_level=Config().logging.level.lower(),
            timeout_graceful_shutdown=0,
        )
        fastapi_server = uvicorn.Server(fastapi_config)
        servers_to_run.append(fastapi_server.serve())

        # FastMCP protocol server on port 3000 (stateful for session persistence)
        mcp_app = self.single_user_mcp.http_app(path="/mcp/", stateless_http=False)
        fastmcp_config = uvicorn.Config(
            app=mcp_app,
            host=self.host,
            port=self.port,
            log_level=Config().logging.level.lower(),
            timeout_graceful_shutdown=0,
        )
        fastmcp_server = uvicorn.Server(fastmcp_config)
        servers_to_run.append(fastmcp_server.serve())

        # Run both servers concurrently
        log.info("🚀 Starting both FastAPI and FastMCP servers...")
        loop = asyncio.get_running_loop()

        def _trigger_shutdown(signame: str) -> None:
            log.info(f"Received {signame}. Forcing shutdown of all servers...")
            for srv in (fastapi_server, fastmcp_server):
                with suppress(Exception):
                    srv.force_exit = True  # type: ignore[attr-defined] # noqa
                    srv.should_exit = True  # type: ignore[attr-defined] # noqa

        for sig in (signal.SIGINT, signal.SIGTERM):
            with suppress(Exception):
                loop.add_signal_handler(sig, _trigger_shutdown, sig.name)

        await asyncio.gather(*servers_to_run, return_exceptions=False)

    def _register_routes(self, app: FastAPI) -> None:
        """Register all routes for the FastAPI app"""
        # Register routes with their decorators
        app.add_api_route("/health", self.health_check, methods=["GET"])
        app.add_api_route(
            "/mcp/status",
            self.mcp_status,
            methods=["GET"],
        )
        # Endpoint to notify server that permissions JSONs changed; invalidate caches
        app.add_api_route(
            "/api/permissions-changed",
            self.permissions_changed,
            methods=["POST"],
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
        app.add_api_route(
            "/mcp/mount/{server_name}",
            self.mount_mcp_server,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/mount/{server_name}",
            self.unmount_mcp_server,
            methods=["DELETE"],
            dependencies=[Depends(self.verify_api_key)],
        )
        # Public sessions endpoint (no auth) for simple local dashboard
        app.add_api_route(
            "/sessions",
            self.get_sessions,
            methods=["GET"],
        )

        # OAuth endpoints
        app.add_api_route(
            "/mcp/oauth/status",
            self.get_oauth_status_all,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/oauth/status/{server_name}",
            self.get_oauth_status,
            methods=["GET"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/oauth/test-connection/{server_name}",
            self.oauth_test_connection,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/oauth/tokens/{server_name}",
            self.oauth_clear_tokens,
            methods=["DELETE"],
            dependencies=[Depends(self.verify_api_key)],
        )
        app.add_api_route(
            "/mcp/oauth/refresh/{server_name}",
            self.oauth_refresh_status,
            methods=["POST"],
            dependencies=[Depends(self.verify_api_key)],
        )

    async def verify_api_key(
        self, credentials: HTTPAuthorizationCredentials = _auth_dependency
    ) -> str:
        """
        Dependency to verify API key from Authorization header.

        Returns the API key string if valid, otherwise raises HTTPException.
        """
        if credentials.credentials != Config().server.api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        return credentials.credentials

    async def permissions_changed(self) -> dict[str, Any]:
        """Invalidate SingleUserMCP manager caches after permissions JSON changed.

        This attempts to clear any known cache methods on the internal managers and then
        warms the lists to ensure subsequent list calls reflect current state.
        """
        try:
            clear_json_file_cache()
            Permissions.clear_permissions_file_cache()
            return {"status": "ok"}
        except Exception as e:  # noqa: BLE001
            log.error(f"Failed to process permissions-changed: {e}")
            raise HTTPException(status_code=500, detail="Failed to invalidate caches") from e

    async def mcp_status(self) -> dict[str, list[dict[str, Any]]]:
        """Get status of configured MCP servers (auth required)."""
        return {
            "servers": [
                {
                    "name": server.name,
                    "enabled": server.enabled,
                }
                for server in Config().mcp_servers
            ]
        }

    async def health_check(self) -> dict[str, Any]:
        """Health check endpoint"""
        return {"status": "healthy", "version": "0.1.0", "mcp_servers": len(Config().mcp_servers)}

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
        """Reinitialize all MCP servers by creating a fresh instance and reloading config.

        Returns a JSON payload summarizing the final mounted servers so callers can display status.
        """
        try:
            log.info("🔄 Reinitializing MCP servers via API endpoint")

            # Initialize the new instance with fresh config
            await self.single_user_mcp.initialize()

            # Summarize final mounted servers
            try:
                mounted = await self.single_user_mcp.get_mounted_servers()
            except Exception:
                log.error("Failed to get mounted servers")
                mounted = []

            names = [m.get("name", "") for m in mounted]
            return {
                "status": "ok",
                "total_final_mounted": len(mounted),
                "mounted_servers": names,
            }

        except Exception as e:
            log.error(f"❌ Failed to reinitialize MCP servers: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to reinitialize MCP servers: {str(e)}",
            ) from e

    async def mount_mcp_server(self, server_name: str) -> dict[str, Any]:
        """Mount a single MCP server by name (auth required)."""
        try:
            ok = await self.single_user_mcp.mount_server(server_name)
            return {"mounted": bool(ok), "server": server_name}
        except Exception as e:
            log.error(f"❌ Failed to mount server {server_name}: {e}")
            raise HTTPException(
                status_code=500, detail=f"Failed to mount server {server_name}: {str(e)}"
            ) from e

    async def unmount_mcp_server(self, server_name: str) -> dict[str, Any]:
        """Unmount a previously mounted MCP server by name (auth required)."""
        try:
            ok = await self.single_user_mcp.unmount(server_name)
            return {"unmounted": bool(ok), "server": server_name}
        except Exception as e:
            log.error(f"❌ Failed to unmount server {server_name}: {e}")
            raise HTTPException(
                status_code=500, detail=f"Failed to unmount server {server_name}: {str(e)}"
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
                has_warned_about_missing_created_at = False
                for row_model in results:
                    row = cast(Any, row_model)
                    tool_calls_val = row.tool_calls
                    data_access_summary_val = row.data_access_summary
                    created_at_val = None
                    if isinstance(data_access_summary_val, dict):
                        created_at_val = data_access_summary_val.get("created_at")  # type: ignore[assignment]
                    if (
                        created_at_val is None
                        and isinstance(tool_calls_val, list)
                        and tool_calls_val
                        and not has_warned_about_missing_created_at
                    ):
                        has_warned_about_missing_created_at = True
                        log.warning(
                            "created_at is missing, will have sessions with unknown timestamps"
                        )
                    sessions.append(
                        {
                            "session_id": row.session_id,
                            "correlation_id": row.correlation_id,
                            "created_at": created_at_val,
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
            tools, resources, prompts = await asyncio.gather(
                _call_list("tools"),
                _call_list("resources"),
                _call_list("prompts"),
                return_exceptions=True,
            )
            tools = tools if isinstance(tools, list) else []
            resources = resources if isinstance(resources, list) else []
            prompts = prompts if isinstance(prompts, list) else []
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

    # ---- OAuth endpoints ----

    async def get_oauth_status_all(self) -> dict[str, Any]:
        """Get OAuth status for all configured MCP servers."""
        try:
            oauth_manager = get_oauth_manager()

            servers_info = {}
            for server_config in Config().mcp_servers:
                server_name = server_config.name
                info = oauth_manager.get_server_info(server_name)

                if info:
                    # Use cached OAuth info
                    servers_info[server_name] = {
                        "server_name": info.server_name,
                        "status": info.status.value,
                        "error_message": info.error_message,
                        "token_expires_at": info.token_expires_at,
                        "has_refresh_token": info.has_refresh_token,
                        "scopes": info.scopes,
                    }
                else:
                    # OAuth status not checked yet - check proactively for remote servers
                    if server_config.is_remote_server():
                        remote_url = server_config.get_remote_url()
                        log.info(f"🔍 Proactively checking OAuth for remote server {server_name}")

                        # Check OAuth requirements for this remote server
                        oauth_info = await oauth_manager.check_oauth_requirement(
                            server_name, remote_url
                        )

                        servers_info[server_name] = {
                            "server_name": oauth_info.server_name,
                            "status": oauth_info.status.value,
                            "error_message": oauth_info.error_message,
                            "token_expires_at": oauth_info.token_expires_at,
                            "has_refresh_token": oauth_info.has_refresh_token,
                            "scopes": oauth_info.scopes,
                        }
                    else:
                        # Local server - no OAuth needed
                        servers_info[server_name] = {
                            "server_name": server_name,
                            "status": OAuthStatus.NOT_REQUIRED.value,
                            "error_message": None,
                            "token_expires_at": None,
                            "has_refresh_token": False,
                            "scopes": None,
                        }

            return {"oauth_status": servers_info}

        except Exception as e:
            log.error(f"Failed to get OAuth status for all servers: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get OAuth status: {str(e)}",
            ) from e

    def _find_server_config(self, server_name: str) -> MCPServerConfig:
        """Find server configuration by name."""
        for config_server in Config().mcp_servers:
            if config_server.name == server_name:
                return config_server
        raise HTTPException(
            status_code=404,
            detail=f"Server configuration not found: {server_name}",
        )

    async def get_oauth_status(self, server_name: str) -> dict[str, Any]:
        """Get OAuth status for a specific MCP server."""
        try:
            server_config = self._find_server_config(server_name)
            oauth_manager = get_oauth_manager()

            # Get the remote URL if this is a remote server
            remote_url = server_config.get_remote_url()

            # Check or refresh OAuth status
            oauth_info = await oauth_manager.check_oauth_requirement(server_name, remote_url)

            return {
                "server_name": oauth_info.server_name,
                "mcp_url": oauth_info.mcp_url,
                "status": oauth_info.status.value,
                "error_message": oauth_info.error_message,
                "token_expires_at": oauth_info.token_expires_at,
                "has_refresh_token": oauth_info.has_refresh_token,
                "scopes": oauth_info.scopes,
                "client_name": oauth_info.client_name,
            }

        except HTTPException:
            raise
        except Exception as e:
            log.error(f"Failed to get OAuth status for {server_name}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get OAuth status: {str(e)}",
            ) from e

    class _OAuthAuthorizeRequest(BaseModel):
        scopes: list[str] | None = Field(None, description="OAuth scopes to request")
        client_name: str | None = Field(None, description="Client name for OAuth registration")

    async def oauth_test_connection(
        self, server_name: str, body: _OAuthAuthorizeRequest | None = None
    ) -> dict[str, Any]:
        """
        Test connection to a remote MCP server, triggering OAuth flow if needed.

        This endpoint creates a temporary FastMCP client with OAuth authentication
        and attempts to make a connection. This automatically triggers FastMCP's
        OAuth flow, which will open a browser for user authorization.
        """
        try:
            server_config = self._find_server_config(server_name)
            oauth_manager = get_oauth_manager()

            # Check if this is a remote server
            if not server_config.is_remote_server():
                raise HTTPException(
                    status_code=400,
                    detail=f"Server {server_name} is a local server and does not support OAuth",
                )

            # Get the remote URL
            remote_url = server_config.get_remote_url()
            if not remote_url:
                raise HTTPException(
                    status_code=400, detail=f"Server {server_name} does not have a valid remote URL"
                )

            # Get OAuth configuration
            scopes = None
            client_name = None

            if body:
                scopes = body.scopes
                client_name = body.client_name

            # Use server config OAuth settings if not provided in request
            if not scopes and server_config.oauth_scopes:
                scopes = server_config.oauth_scopes
            if not client_name and server_config.oauth_client_name:
                client_name = server_config.oauth_client_name

            log.info(f"🔗 Testing connection to {server_name} at {remote_url}")

            # Create OAuth auth object
            oauth = OpenEdisonOAuth(
                mcp_url=remote_url,
                scopes=scopes,
                client_name=client_name or "OpenEdison MCP Gateway",
                token_storage_cache_dir=oauth_manager.cache_dir,
                callback_port=50001,
            )

            # Create a temporary client and test the connection
            # This will automatically trigger OAuth flow if tokens don't exist
            try:
                async with FastMCPClient(remote_url, auth=oauth) as client:
                    # Try to ping the server - this triggers OAuth if needed
                    log.info(
                        f"🔐 Attempting to connect to {server_name} (may open browser for OAuth)..."
                    )
                    await client.ping()
                    log.info(f"✅ Successfully connected to {server_name}")

                    # Update OAuth status in manager
                    await oauth_manager.check_oauth_requirement(server_name, remote_url)

                    return {
                        "status": "connection_successful",
                        "message": f"Successfully connected to {server_name}. OAuth tokens are now cached.",
                        "server_name": server_name,
                    }

            except Exception as e:
                log.error(f"❌ Failed to connect to {server_name}: {e}")

                # Check if this was an OAuth-related error
                error_message = str(e)
                if "oauth" in error_message.lower() or "authorization" in error_message.lower():
                    return {
                        "status": "oauth_required",
                        "message": f"OAuth authorization completed for {server_name}. Please try connecting again.",
                        "server_name": server_name,
                    }
                raise HTTPException(
                    status_code=500, detail=f"Connection test failed: {error_message}"
                ) from None

        except HTTPException:
            raise
        except Exception as e:
            log.error(f"Failed to test connection for {server_name}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to test connection: {str(e)}",
            ) from e

    async def oauth_clear_tokens(self, server_name: str) -> dict[str, Any]:
        """Clear stored OAuth tokens for a server."""
        try:
            server_config = self._find_server_config(server_name)
            oauth_manager = get_oauth_manager()

            # Check if this is a remote server
            if not server_config.is_remote_server():
                raise HTTPException(
                    status_code=400,
                    detail=f"Server {server_name} is a local server and does not support OAuth",
                )

            # Get the remote URL
            remote_url = server_config.get_remote_url()
            if not remote_url:
                raise HTTPException(
                    status_code=400, detail=f"Server {server_name} does not have a valid remote URL"
                )

            success = oauth_manager.clear_tokens(server_name, remote_url)

            if success:
                return {
                    "status": "success",
                    "message": f"OAuth tokens cleared for {server_name}",
                    "server_name": server_name,
                }
            raise HTTPException(
                status_code=500, detail=f"Failed to clear OAuth tokens for {server_name}"
            )

        except HTTPException:
            raise
        except Exception as e:
            log.error(f"Failed to clear OAuth tokens for {server_name}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to clear OAuth tokens: {str(e)}",
            ) from e

    async def oauth_refresh_status(self, server_name: str) -> dict[str, Any]:
        """Refresh OAuth status for a server."""
        try:
            server_config = self._find_server_config(server_name)
            oauth_manager = get_oauth_manager()

            # Check if this is a remote server
            if not server_config.is_remote_server():
                raise HTTPException(
                    status_code=400,
                    detail=f"Server {server_name} is a local server and does not support OAuth",
                )

            # Get the remote URL (now guaranteed to be non-None for remote servers)
            remote_url = server_config.get_remote_url()
            if not remote_url:
                raise HTTPException(
                    status_code=400, detail=f"Server {server_name} does not have a valid remote URL"
                )

            # Refresh OAuth status
            oauth_info = await oauth_manager.refresh_server_status(server_name, remote_url)

            return {
                "status": "refreshed",
                "server_name": oauth_info.server_name,
                "oauth_status": oauth_info.status.value,
                "error_message": oauth_info.error_message,
                "token_expires_at": oauth_info.token_expires_at,
                "has_refresh_token": oauth_info.has_refresh_token,
                "scopes": oauth_info.scopes,
            }

        except HTTPException:
            raise
        except Exception as e:
            log.error(f"Failed to refresh OAuth status for {server_name}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to refresh OAuth status: {str(e)}",
            ) from e
