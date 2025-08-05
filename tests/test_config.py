"""
Tests for configuration management
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.config import Config, MCPServerConfig
from tests.test_template import TestTemplate


class TestConfiguration(TestTemplate):
    """Test configuration system using test template"""

    def test_config_creation(self):
        """Test basic config creation"""
        config = Config.create_default()

        assert config.server.host == "localhost"
        assert config.server.port == 3000
        assert config.logging.level == "INFO"
        assert len(config.mcp_servers) == 1
        assert config.mcp_servers[0].name == "filesystem"

    def test_config_save_and_load(self):
        """Test saving and loading configuration"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = Path(f.name)

        try:
            # Create and save config
            original_config = Config.create_default()
            original_config.server.port = 4000
            original_config.save(config_path)

            # Load config
            loaded_config = Config.load(config_path)

            assert loaded_config.server.port == 4000
            assert loaded_config.server.host == "localhost"

        finally:
            config_path.unlink()

    def test_mcp_server_config(self):
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

    def test_mcp_server_config_default_env(self):
        """Test MCP server configuration with default env"""
        server_config = MCPServerConfig(name="test-server", command="python", args=["-m", "test"])

        assert server_config.env == {}

    def test_invalid_config_handling(self):
        """Test handling of invalid configuration"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write('{"invalid": "json"')  # Invalid JSON
            config_path = Path(f.name)

        try:
            with pytest.raises(json.JSONDecodeError):  # Should raise JSON parsing error
                Config.load(config_path)
        finally:
            config_path.unlink()

    def test_test_config_setup(self):
        """Test that test configuration is properly set up"""
        assert self.test_config.server.api_key == "test-api-key-for-testing"
        assert self.test_config.server.port == 3001
        assert len(self.test_config.mcp_servers) == 1
        assert self.test_config.mcp_servers[0].name == "test-echo"
