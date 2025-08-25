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
from src.permissions import Permissions
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

        # Provide a default test config available to tests
        self.test_config = create_test_config()

        global all_permissions
        all_permissions = Permissions.load(self.config_dir)

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
        """FastAPI TestClient bound to an OpenEdisonProxy using test config."""
        # Patch global config during the test client lifetime
        import src.config as cfg

        original_config = cfg.config
        cfg.config = self.test_config
        try:
            proxy = OpenEdisonProxy(
                host=self.test_config.server.host,
                port=self.test_config.server.port,
            )
            client = TestClient(proxy.fastapi_app)
            yield client
        finally:
            cfg.config = original_config


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
        # Mock the global config to use test config BEFORE creating proxy
        import src.config

        original_config = src.config.config
        src.config.config = self.test_config

        try:
            self.server_proxy = OpenEdisonProxy(
                host=self.test_config.server.host,
                port=self.test_config.server.port
                - 1,  # Use port 3000 for FastMCP, 3001 for FastAPI
            )

            async def init_single_user_mcp():
                await self.server_proxy.single_user_mcp.initialize(self.test_config)

            import socket

            def get_free_port():
                """Get a free port to use for testing"""
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("localhost", 0))
                    return s.getsockname()[1]

            test_api_port = get_free_port()
            test_mcp_port = get_free_port()

            self.test_config.server.port = test_api_port

            self.base_url = f"http://{self.test_config.server.host}:{test_api_port}"

            # Start server in background thread - only start FastAPI management server for tests
            def run_server() -> None:
                asyncio.set_event_loop(asyncio.new_event_loop())
                loop = asyncio.get_event_loop()

                # Create a new OpenEdisonProxy with the test config
                self.server_proxy = OpenEdisonProxy(
                    host=self.test_config.server.host, port=test_mcp_port
                )

                # Initialize SingleUserMCP with test config
                loop.run_until_complete(
                    self.server_proxy.single_user_mcp.initialize(self.test_config)
                )

                app = self.server_proxy.fastapi_app

                print(f"DEBUG: Registered routes: {[route.path for route in app.routes]}")

                uvicorn_config = uvicorn.Config(
                    app=app,
                    host=self.test_config.server.host,
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
            # Restore original config
            src.config.config = original_config

    @pytest.fixture
    def requests_session(self):
        """Provide a requests.Session for integration tests."""
        session = requests.Session()
        try:
            yield session
        finally:
            session.close()

    def _wait_for_server(self, timeout: int = 5) -> None:
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
    """Test that test template works correctly"""
    config = create_test_config()
    assert config.server.host == "localhost"
    assert config.server.api_key == "test-api-key-for-testing"
    assert len(config.mcp_servers) == 1
    assert config.mcp_servers[0].name == "test-echo"
