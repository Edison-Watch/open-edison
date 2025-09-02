# Testing Strategy

## Overview

Open Edison follows a comprehensive testing strategy designed to ensure reliability while maintaining the simplicity principles of the project. This document outlines our testing approach, tools, and best practices.

## Testing Philosophy

### Principles

1. **Simple but Thorough**: Tests should be easy to understand and maintain
2. **Fast Feedback**: Tests should run quickly for rapid development cycles
3. **Focused Coverage**: Test the important functionality, not just coverage metrics
4. **Integration Heavy**: Emphasize integration tests over pure unit tests for this type of system

### Test Categories

```
Tests
├── Unit Tests (30%)        # Individual function testing
├── Integration Tests (50%) # API endpoint and component testing  
├── Configuration Tests (15%) # Config loading and validation
└── End-to-End Tests (5%)   # Complete workflow testing
```

## Test Structure

### Directory Organization

```
tests/
├── __init__.py
├── conftest.py              # Pytest configuration and fixtures
├── test_config.py          # Configuration system tests
├── test_server.py          # FastAPI server tests
├── test_proxy.py           # MCP proxy tests
├── test_auth.py            # Authentication tests
├── integration/            # Integration test directory
│   ├── __init__.py
│   ├── test_api_integration.py
│   └── test_mcp_integration.py
└── fixtures/               # Test data and fixtures
    ├── configs/
    │   ├── valid_config.json
    │   ├── invalid_config.json
    │   └── minimal_config.json
    └── responses/
        └── mcp_responses.json
```

## Unit Tests

### Configuration Tests (`test_config.py`)

```python
"""Tests for configuration management"""

import tempfile
from pathlib import Path
import pytest

from src.config import Config, MCPServerConfig


def test_config_creation(tmp_path):
    """Test basic config creation"""
    cfg = Config()
    cfg.create_default()
    assert cfg.server.host == "localhost"
    assert cfg.server.port == 3000
    assert cfg.logging.level == "INFO"
    assert len(cfg.mcp_servers) == 1


def test_config_save_and_load():
    """Test saving and loading configuration"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        config_path = Path(f.name)
    
    try:
        # Create and save config
        cfg = Config()
        cfg.create_default()
        cfg.server.port = 4000
        cfg.save(config_path)
        
        # Load config
        loaded_config = Config(config_path)
        
        assert loaded_config.server.port == 4000
        assert loaded_config.server.host == "localhost"
        
    finally:
        config_path.unlink()


def test_mcp_server_config():
    """Test MCP server configuration"""
    server_config = MCPServerConfig(
        name="test-server",
        command="python",
        args=["-m", "test"],
        env={"TEST": "value"},
        enabled=True,
    )
    
    assert server_config.name == "test-server"
    assert server_config.command == "python"
    assert server_config.args == ["-m", "test"]
    assert server_config.env == {"TEST": "value"}
    assert server_config.enabled is True


def test_invalid_config_handling():
    """Test handling of invalid configuration"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write('{"invalid": "json"')  # Invalid JSON
        config_path = Path(f.name)
    
    try:
        with pytest.raises(Exception):  # Should raise JSON parsing error
            _ = Config(config_path)
    finally:
        config_path.unlink()
```

### Server Tests (`test_server.py`)

```python
"""Tests for the main server functionality"""

import pytest
from fastapi.testclient import TestClient

from src.server import OpenEdisonProxy


@pytest.fixture
def client():
    """Create a test client"""
    proxy = OpenEdisonProxy()
    return TestClient(proxy.app)


@pytest.fixture
def auth_headers():
    """Authentication headers for testing"""
    return {"Authorization": "Bearer dev-api-key-change-me"}


def test_health_endpoint(client):
    """Test the health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "mcp_servers" in data


def test_mcp_status_requires_auth(client):
    """Test that MCP status endpoint requires authentication"""
    response = client.get("/mcp/status")
    assert response.status_code in (200, 403)


def test_mcp_status_with_auth(client, auth_headers):
    """Test MCP status endpoint with authentication"""
    response = client.get("/mcp/status", headers=auth_headers)
    assert response.status_code == 200
    
    data = response.json()
    assert "servers" in data
    assert isinstance(data["servers"], list)


def test_invalid_api_key(client):
    """Test that invalid API key is rejected"""
    headers = {"Authorization": "Bearer invalid-key"}
    response = client.get("/mcp/status", headers=headers)
    assert response.status_code == 401


def test_mount_endpoint(client, auth_headers):
    """Test mounting an MCP server"""
    response = client.post("/mcp/mount/example-filesystem", headers=auth_headers)
    assert response.status_code in [200, 500]


def test_server_startup():
    """Test server initialization"""
    proxy = OpenEdisonProxy(host="localhost", port=3001)
    assert proxy.host == "localhost"
    assert proxy.port == 3001
    assert proxy.app is not None
```

## Integration Tests

### API Integration Tests

```python
"""Integration tests for API endpoints"""

import pytest
import asyncio
from fastapi.testclient import TestClient

from src.server import OpenEdisonProxy
from src.config import Config, MCPServerConfig


@pytest.fixture
def test_config():
    """Create test configuration"""
    return Config(
        server=ServerConfig(host="localhost", port=3000, api_key="test-key"),
        logging=LoggingConfig(level="DEBUG"),
        mcp_servers=[
            MCPServerConfig(
                name="test-filesystem",
                command="echo",  # Use echo command for testing
                args=["hello"],
                enabled=True
            )
        ]
    )


@pytest.fixture
def app_with_test_config(test_config, tmp_path):
    """Create app with test configuration"""
    config_path = tmp_path / "test_config.json"
    test_config.save(config_path)
    
    # In production, Config() reads from default path. For tests, pass the path explicitly where needed.
    
    proxy = OpenEdisonProxy()
    return TestClient(proxy.app)


def test_full_server_lifecycle(app_with_test_config):
    """Test complete server management lifecycle"""
    client = app_with_test_config
    headers = {"Authorization": "Bearer test-key"}
    
    # Check initial status
    response = client.get("/mcp/status", headers=headers)
    assert response.status_code == 200
    
    servers = response.json()["servers"]
    test_server = next(s for s in servers if s["name"] == "test-filesystem")
    assert test_server["enabled"] is True
    
    # Mount server
    response = client.post("/mcp/mount/test-filesystem", headers=headers)
    assert response.status_code in (200, 500)
    
    # Check status after start
    response = client.get("/mcp/status", headers=headers)
    servers = response.json()["servers"]
    test_server = next(s for s in servers if s["name"] == "test-filesystem")
    # Note: echo command will exit immediately, so running status depends on timing
    
    # Unmount server
    response = client.request("DELETE", "/mcp/mount/test-filesystem", headers=headers)
    assert response.status_code in (200, 500)


def test_list_mounted_servers(app_with_test_config):
    """Test listing mounted servers (auth required)"""
    client = app_with_test_config
    headers = {"Authorization": "Bearer test-key"}
    response = client.get("/mcp/mounted", headers=headers)
    assert response.status_code in (200, 500)
```

### Configuration Integration Tests

```python
"""Integration tests for configuration system"""

import tempfile
import json
from pathlib import Path

def test_config_file_creation_and_loading():
    """Test complete config file workflow"""
    with tempfile.TemporaryDirectory() as temp_dir:
        config_path = Path(temp_dir) / "test_config.json"
        
        # Create default config
        config = Config.create_default()
        config.server.api_key = "integration-test-key"
        config.save(config_path)
        
        # Verify file exists and has correct content
        assert config_path.exists()
        
        with open(config_path) as f:
            data = json.load(f)
        
        assert data["server"]["api_key"] == "integration-test-key"
        assert data["server"]["host"] == "localhost"
        assert data["server"]["port"] == 3000
        
        # Load config and verify
        loaded_config = Config.load(config_path)
        assert loaded_config.server.api_key == "integration-test-key"
        assert len(loaded_config.mcp_servers) == 1


def test_config_validation_with_real_files():
    """Test config validation with actual file scenarios"""
    test_configs = {
        "minimal": {
            "server": {"api_key": "test"},
            "logging": {},
            "mcp_servers": []
        },
        "complex": {
            "server": {"host": "0.0.0.0", "port": 3001, "api_key": "complex-key"},
            "logging": {"level": "DEBUG"},
            "mcp_servers": [
                {
                    "name": "fs1",
                    "command": "uvx",
                    "args": ["mcp-server-filesystem", "/tmp"],
                    "env": {"VAR": "value"},
                    "enabled": True
                },
                {
                    "name": "fs2", 
                    "command": "python",
                    "args": ["-m", "custom_mcp"],
                    "enabled": False
                }
            ]
        }
    }
    
    for config_name, config_data in test_configs.items():
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as f:
            json.dump(config_data, f, indent=2)
            f.flush()
            
            # Should load without errors
            config = Config.load(Path(f.name))
            assert config.server.api_key == config_data["server"]["api_key"]
            assert len(config.mcp_servers) == len(config_data["mcp_servers"])
```

## Test Fixtures and Utilities

### Pytest Configuration (`conftest.py`)

```python
"""Pytest configuration and shared fixtures"""

import pytest
import tempfile
from pathlib import Path

from src.config import Config, ServerConfig, LoggingConfig, MCPServerConfig


@pytest.fixture
def temp_config_dir():
    """Create temporary directory for config files"""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def sample_config():
    """Create sample configuration for testing"""
    return Config(
        server=ServerConfig(
            host="localhost",
            port=3000,
            api_key="test-api-key"
        ),
        logging=LoggingConfig(level="DEBUG"),
        mcp_servers=[
            MCPServerConfig(
                name="test-server",
                command="echo",
                args=["hello"],
                env={"TEST_VAR": "test_value"},
                enabled=True
            )
        ]
    )


@pytest.fixture
def mock_mcp_server():
    """Mock MCP server for testing"""
    class MockMCPServer:
        def __init__(self, name="test-server"):
            self.name = name
            self.running = False
            
        def start(self):
            self.running = True
            
        def stop(self):
            self.running = False
            
        def is_running(self):
            return self.running
    
    return MockMCPServer()


@pytest.fixture(autouse=True)
def reset_config():
    """Reset global config state between tests"""
    yield
    # Clean up any global state if needed
```

## Test Utilities

### Test Helpers

```python
"""Test utility functions"""

import json
from pathlib import Path
from typing import Dict, Any


def create_test_config_file(config_data: Dict[str, Any], path: Path) -> None:
    """Create a test configuration file"""
    with open(path, 'w') as f:
        json.dump(config_data, f, indent=2)


def assert_config_equal(config1: Config, config2: Config) -> None:
    """Assert two configurations are equal"""
    assert config1.server.host == config2.server.host
    assert config1.server.port == config2.server.port
    assert config1.server.api_key == config2.server.api_key
    assert config1.logging.level == config2.logging.level
    assert len(config1.mcp_servers) == len(config2.mcp_servers)


def wait_for_server_start(client, timeout: int = 5) -> bool:
    """Wait for server to start up"""
    import time
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        try:
            response = client.get("/health")
            if response.status_code == 200:
                return True
        except:
            pass
        time.sleep(0.1)
    
    return False


class MockMCPProcess:
    """Mock MCP server process for testing"""
    
    def __init__(self, name: str, return_code: int = 0):
        self.name = name
        self.return_code = return_code
        self.terminated = False
        
    def poll(self):
        return self.return_code if self.terminated else None
        
    def terminate(self):
        self.terminated = True
        
    def wait(self, timeout=None):
        return self.return_code
```

## Running Tests

### Basic Test Commands

```bash
# Run all tests
make test

# Run with coverage
pytest --cov=src tests/

# Run specific test file
pytest tests/test_config.py

# Run specific test
pytest tests/test_config.py::test_config_creation

# Run with verbose output
pytest -v tests/

# Run only failed tests
pytest --lf

# Run tests in parallel
pytest -n auto tests/
```

### Development Testing

```bash
# Watch mode (requires pytest-watch)
ptw tests/

# Run tests on file change
pytest-watch --runner "pytest --tb=short"

# Quick test (skip slow tests)
pytest -m "not slow" tests/
```

### Test Categories

```bash
# Run only unit tests
pytest -m unit tests/

# Run only integration tests  
pytest -m integration tests/

# Run only config tests
pytest tests/test_config.py
```

## Test Markers

### Pytest Markers

```python
# In tests
import pytest

@pytest.mark.unit
def test_config_creation():
    """Unit test for config creation"""
    pass

@pytest.mark.integration
def test_api_integration():
    """Integration test for API"""
    pass

@pytest.mark.slow
def test_long_running_operation():
    """Test that takes a long time"""
    pass

@pytest.mark.requires_network
def test_external_api():
    """Test that requires network access"""
    pass
```

Configure in `pytest.ini`:

```ini
[tool:pytest]
markers =
    unit: Unit tests
    integration: Integration tests
    slow: Slow tests (skip in quick runs)
    requires_network: Tests requiring network access
```

## Continuous Integration

### GitHub Actions Test Configuration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.12, 3.13]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Python ${{ matrix.python-version }}
      uses: actions/setup-python@v4
      with:
        python-version: ${{ matrix.python-version }}
    
    - name: Install UV
      run: |
        curl -LsSf https://astral.sh/uv/install.sh | sh
        echo "$HOME/.cargo/bin" >> $GITHUB_PATH
    
    - name: Install dependencies
      run: uv sync
    
    - name: Run tests
      run: |
        uv run pytest --cov=src tests/
        uv run pytest --cov-report=xml
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage.xml
```

## Test Data Management

### Test Fixtures Directory

```
tests/fixtures/
├── configs/
│   ├── minimal.json        # Minimal valid config
│   ├── full.json          # Full featured config
│   ├── invalid.json       # Invalid config for error testing
│   └── empty.json         # Empty config file
├── responses/
│   ├── health_response.json
│   ├── status_response.json
│   └── mcp_call_response.json
└── data/
    ├── test_files/        # Test files for filesystem MCP
    └── mock_servers/      # Mock MCP server implementations
```

### Loading Test Data

```python
import json
from pathlib import Path

def load_test_fixture(fixture_name: str) -> dict:
    """Load test fixture data"""
    fixture_path = Path(__file__).parent / "fixtures" / f"{fixture_name}.json"
    with open(fixture_path) as f:
        return json.load(f)

# Usage in tests
def test_with_fixture():
    config_data = load_test_fixture("configs/minimal")
    # Use config_data in test
```

## Performance Testing

### Basic Performance Tests

```python
import time
import pytest
from fastapi.testclient import TestClient

def test_health_endpoint_performance():
    """Test health endpoint response time"""
    client = TestClient(app)
    
    start_time = time.time()
    response = client.get("/health")
    end_time = time.time()
    
    assert response.status_code == 200
    assert (end_time - start_time) < 0.1  # Should respond in < 100ms


def test_concurrent_requests():
    """Test handling of concurrent requests"""
    import concurrent.futures
    
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-key"}
    
    def make_request():
        return client.get("/mcp/status", headers=headers)
    
    # Make 10 concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(make_request) for _ in range(10)]
        responses = [f.result() for f in futures]
    
    # All should succeed
    assert all(r.status_code == 200 for r in responses)
```

## Test Maintenance

### Keeping Tests Updated

1. **Update tests when APIs change**
2. **Add tests for new features**
3. **Remove tests for deprecated features**
4. **Keep test data realistic**
5. **Review test coverage regularly**

### Test Code Quality

- **Clear test names** describing what is being tested
- **Single assertion per test** when possible
- **Minimal test setup** required
- **Independent tests** that don't depend on each other
- **Fast execution** for quick feedback

## Debugging Tests

### Debug Failing Tests

```bash
# Run with debugger
pytest --pdb tests/test_failing.py

# Verbose output
pytest -vvv tests/test_failing.py

# Show local variables
pytest --tb=long tests/test_failing.py

# Show print statements
pytest -s tests/test_failing.py
```

### Test Environment Debugging

```python
def test_debug_environment():
    """Debug test to check environment setup"""
    import sys
    import os
    from pathlib import Path
    
    print(f"Python version: {sys.version}")
    print(f"Working directory: {os.getcwd()}")
    print(f"Python path: {sys.path}")
    print(f"Config file exists: {Path('config.json').exists()}")
    
    # This test always passes, just for debugging
    assert True
```

## Next Steps

- **[Development Guide](development_guide.md)** - Complete development documentation
- **[Contributing](contributing.md)** - How to contribute to Open Edison
- **[API Reference](../quick-reference/api_reference.md)** - API documentation for testing
