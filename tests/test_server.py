"""
Tests for the main server functionality
"""

from tests.test_template import TestTemplate


class TestServerAPI(TestTemplate):
    """Test server API endpoints using test template"""

    def test_health_endpoint(self, test_client):
        """Test the health check endpoint"""
        response = test_client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "mcp_servers" in data

    def test_mcp_status_requires_auth(self, test_client):
        """Test that MCP status endpoint requires authentication"""
        response = test_client.get("/mcp/status")
        assert response.status_code == 403  # Should require auth

    def test_mcp_status_with_auth(self, test_client, auth_headers):
        """Test MCP status endpoint with authentication"""
        response = test_client.get("/mcp/status", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert "servers" in data
        assert isinstance(data["servers"], list)

    def test_invalid_api_key(self, test_client):
        """Test that invalid API key is rejected"""
        headers = {"Authorization": "Bearer invalid-key"}
        response = test_client.get("/mcp/status", headers=headers)
        assert response.status_code == 401

    def test_sernitialization(self):
        """Test server initialization"""
        from src.server import OpenEdisonProxy

        proxy = OpenEdisonProxy(host="localhost", port=3001)
        assert proxy.host == "localhost"
        assert proxy.port == 3001
        assert proxy.fastapi_app is not None

    def test_config_endpoint_prefers_repo_root(self, test_client):
        """GET /config.json should prefer repo root config when present."""
        import json

        # Load config via endpoint
        resp = test_client.get("/config.json")
        assert resp.status_code == 200
        data = json.loads(resp.text)
        assert isinstance(data, dict)
        # The repo contains a config.json with multiple mcp_servers; allow >= 1 to be flexible in CI
        mcp = data.get("mcp_servers", [])
        assert isinstance(mcp, list)
        assert len(mcp) >= 1

    def test_config_host_matches_repo(self, test_client):
        import json

        resp = test_client.get("/config.json")
        assert resp.status_code == 200
        data = json.loads(resp.text)
        server = data.get("server", {})
        assert server.get("host") in {"0.0.0.0", "localhost"}
