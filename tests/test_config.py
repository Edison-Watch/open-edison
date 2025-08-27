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

    def test_config_creation(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
        """Test basic config creation with isolated config dir."""
        # Use current default behavior; host may be 0.0.0.0 or localhost depending on repo config
        config = Config()

        assert config.server.host in {"localhost", "0.0.0.0"}
        assert config.server.port == 3000
        assert config.logging.level == "INFO"
        # Repo root config contains multiple servers; ensure at least one exists
        assert isinstance(config.mcp_servers, list)
        assert len(config.mcp_servers) >= 1
        assert any(s.name == "filesystem" for s in config.mcp_servers)

    def test_config_save_and_load(self):
        """Test saving and loading configuration"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = Path(f.name)

        try:
            # Create and save config
            original_config = Config()
            original_config.server.port = 4000
            original_config.save(config_path)

            # Load config
            loaded_config = Config(config_path)

            assert loaded_config.server.port == 4000
            assert loaded_config.server.host == original_config.server.host

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
                Config(config_path)
        finally:
            config_path.unlink()

    def test_default_config_is_loadable(self):
        """Ensure default/repo config is loadable without relying on singleton overrides."""
        cfg = Config()
        assert cfg.server.host in {"localhost", "0.0.0.0"}
        assert isinstance(cfg.server.port, int)
        assert isinstance(cfg.mcp_servers, list)
