"""
Test template for Open Edison tests.

Provides base test class with server setup and common fixtures.
"""

import asyncio
import threading
import time
from pathlib import Path
from typing import Any

import pytest
import requests
import uvicorn
from fastapi.testclient import TestClient

from src.config import Config, LoggingConfig, MCPServerConfig, ServerConfig
from src.server import OpenEdisonProxy

# Test markers
slow_test = pytest.mark.slow
integration_test = pytest.mark.integration


class TestTemplate:
    """
    Base test class for Open Edison tests.

    Provides common fixtures and server management for testing.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test environment with temporary configuration"""
        # Use repo root as config dir so we pick up repo-local JSON files
        self.config_dir = Path(__file__).parent.parent
        # No global singleton; permissions and config are instantiated per-call now

    @pytest.fixture(autouse=True)
    def _override_config_dir(self, monkeypatch: pytest.MonkeyPatch):
        """Force app to use repo-root JSONs and config during tests."""
        monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(Path(__file__).parent.parent))

    @pytest.fixture
    def test_server_config(self) -> dict[str, Any]:
        """Provide test server configuration"""
        return {
            "name": "test-server",
            "command": "echo",
            "args": ["test"],
            "env": {"TEST": "true"},
            "enabled": True,
        }

    @pytest.fixture
    def test_client(self):
        """FastAPI TestClient bound to an OpenEdisonProxy using default config."""
        proxy = OpenEdisonProxy(host="localhost", port=3000)
        client = TestClient(proxy.fastapi_app)
        yield client


class BackgroundServerTemplate(TestTemplate):
    """
    Test template that runs Open Edison server in background.

    Use this for integration tests that need a real running server.
    """

    server_thread: threading.Thread | None = None
    server_proxy: OpenEdisonProxy | None = None

    @pytest.fixture(autouse=True)
    def background_server(self, setup, request: Any) -> Any:
        """Start Open Edison server in background thread"""
        import socket

        try:

            def get_free_port():
                """Get a free port to use for testing"""
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", 0))
                    return s.getsockname()[1]

            test_api_port = get_free_port()
            test_mcp_port = get_free_port()

            self.base_url = f"http://127.0.0.1:{test_api_port}"

            # Start server in background thread - only start FastAPI management server for tests
            def run_server() -> None:
                asyncio.set_event_loop(asyncio.new_event_loop())
                loop = asyncio.get_event_loop()

                # Create a new OpenEdisonProxy with dynamic ports
                self.server_proxy = OpenEdisonProxy(host="127.0.0.1", port=test_mcp_port)

                # Initialize SingleUserMCP with current config
                loop.run_until_complete(self.server_proxy.single_user_mcp.initialize())

                app = self.server_proxy.fastapi_app

                print(f"DEBUG: Registered routes: {[route.path for route in app.routes]}")

                uvicorn_config = uvicorn.Config(
                    app=app,
                    host="127.0.0.1",
                    port=test_api_port,  # Use dynamic port
                    log_level="critical",  # Suppress uvicorn logs in tests
                )
                server = uvicorn.Server(uvicorn_config)
                loop.run_until_complete(server.serve())

            self.server_thread = threading.Thread(target=run_server, daemon=True)
            self.server_thread.start()

            # Wait for server to start
            self._wait_for_server()

            yield

        finally:
            pass

    @pytest.fixture
    def requests_session(self):
        """Provide a requests.Session for integration tests."""
        session = requests.Session()
        try:
            yield session
        finally:
            session.close()

    def _wait_for_server(self, timeout: int = 15) -> None:
        """Wait for server to start accepting connections"""
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                response = requests.get(f"{self.base_url}/health", timeout=1)  # type: ignore
                if response.status_code == 200:
                    return
            except Exception:
                # Server not up yet; keep retrying until timeout
                pass
            time.sleep(0.1)

        raise TimeoutError(f"Server did not start within {timeout} seconds")


class MockMCPServer:
    """
    Mock MCP server for testing without real MCP dependencies.
    """

    def __init__(self, name: str = "mock-server"):
        self.name = name
        self.running = False
        self.process = None

    def start(self):
        """Mock server start"""
        self.running = True
        return True

    def stop(self):
        """Mock server stop"""
        self.running = False
        return True

    def is_running(self) -> bool:
        """Check if mock server is running"""
        return self.running


# Utility functions for tests
def create_test_config(**overrides: Any) -> Config:
    """Create test configuration with optional overrides"""
    config_data: dict[str, Any] = {
        "server": {"host": "localhost", "port": 3001, "api_key": "test-api-key-for-testing"},
        "logging": {"level": "DEBUG", "database_path": "/tmp/test_sessions.db"},
        "mcp_servers": [
            {"name": "test-echo", "command": "echo", "args": ["hello"], "env": {}, "enabled": True}
        ],
    }

    # Apply overrides
    def deep_update(d: dict[str, Any], u: dict[str, Any]) -> dict[str, Any]:  # type: ignore
        for k, v in u.items():
            if isinstance(v, dict):
                d[k] = deep_update(d.get(k, {}), v)  # type: ignore
            else:
                d[k] = v
        return d

    if overrides:
        config_data = deep_update(config_data, overrides)

    return Config(
        server=ServerConfig(**config_data["server"]),
        logging=LoggingConfig(**config_data["logging"]),
        mcp_servers=[MCPServerConfig(**server) for server in config_data["mcp_servers"]],  # type: ignore
    )


def wait_for_condition(condition_func: Any, timeout: int = 5, interval: float = 0.1) -> bool:
    """Wait for a condition to become true"""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if condition_func():
            return True
        time.sleep(interval)
    return False


def assert_server_response(
    response: Any, expected_status: int = 200, expected_keys: list[str] | None = None
) -> None:
    """Assert server response format"""
    assert response.status_code == expected_status, (
        f"Expected {expected_status}, got {response.status_code}: {response.text}"
    )

    if expected_keys:
        data = response.json()
        for key in expected_keys:
            assert key in data, f"Missing key '{key}' in response: {data}"


# Test configuration validation
def test_template_sanity() -> None:
    """Basic sanity checks for the template and config loading."""
    from src.config import Config

    cfg = Config()
    assert cfg.server.host in {"localhost", "0.0.0.0"}
    assert isinstance(cfg.mcp_servers, list)
    assert len(cfg.mcp_servers) >= 0
