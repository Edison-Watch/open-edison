import shutil

import pytest

from src.config import Config, MCPServerConfig
from src.mcp_importer.api import verify_mcp_server
from tests.test_template import TestTemplate


class TestVerifyMCPServer(TestTemplate):
    def test_verify_filesystem_mcp(self) -> None:
        if shutil.which("npx") is None:
            pytest.skip("npx not available on PATH; skipping real MCP verification test")

        cfg = Config()
        server: MCPServerConfig | None = next(
            (s for s in cfg.mcp_servers if s.name == "filesystem"), None
        )
        assert server is not None, "filesystem server not found in config.json"

        # Exercise the real verification path (spawns via FastMCP and lists tools/resources/prompts)
        result = verify_mcp_server(server)
        assert result is True
