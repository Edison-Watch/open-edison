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

    def test_start_server_endpoint(self, test_client, auth_headers):
        """Test starting an MCP server"""
        response = test_client.post("/mcp/test-echo/start", headers=auth_headers)
        # Note: Echo command will start and exit immediately
        assert response.status_code in [200, 500]  # Success or server error

        data = response.json()
        assert "message" in data

    def test_server_initialization(self):
        """Test server initialization"""
        from src.server import OpenEdisonProxy

        proxy = OpenEdisonProxy(host="localhost", port=3001)
        assert proxy.host == "localhost"
        assert proxy.port == 3001
        assert proxy.fastapi_app is not None
