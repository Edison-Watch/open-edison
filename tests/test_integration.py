"""
Integration tests for Open Edison using background server.

These tests run against a real server instance in the background.
"""

from tests.test_template import BackgroundServerTemplate, integration_test, slow_test


class TestBackgroundServerIntegration(BackgroundServerTemplate):
    """Integration tests with background server"""

    @integration_test
    def test_server_startup_and_health(self, requests_session):
        """Test that background server starts and responds to health checks"""
        response = requests_session.get(f"{self.base_url}/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data

    @integration_test
    def test_mcp_status_endpoint(self, requests_session):
        """Test MCP status endpoint with background server"""
        response = requests_session.get(f"{self.base_url}/mcp/status")

        assert response.status_code == 200
        data = response.json()
        assert "servers" in data
        assert isinstance(data["servers"], list)

        # Should have our test echo server
        server_names = [s["name"] for s in data["servers"]]
        assert "test-echo" in server_names

    @integration_test
    @slow_test
    def test_mcp_server_lifecycle(self, requests_session):
        """Test complete MCP server start/stop lifecycle"""
        # Start the test echo server
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/start")
        assert response.status_code == 200

        # Check status - echo will exit immediately but start should succeed
        response = requests_session.get(f"{self.base_url}/mcp/status")
        assert response.status_code == 200

        # Stop the server
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/stop")
        assert response.status_code == 200

    @integration_test
    def test_mcp_call_placeholder(self, requests_session):
        """Test MCP call endpoint (currently placeholder)"""
        request_data = {"method": "tools/list", "id": 1, "params": {}}

        response = requests_session.post(f"{self.base_url}/mcp/call", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["jsonrpc"] == "2.0"
        assert data["id"] == 1
        assert "result" in data

    @integration_test
    def test_sessions_endpoint_placeholder(self, requests_session):
        """Test sessions endpoint (currently placeholder)"""
        response = requests_session.get(f"{self.base_url}/sessions")

        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert "message" in data
        assert data["sessions"] == []

    @integration_test
    def test_authentication_required(self):
        """Test that authentication is required for protected endpoints"""

        # No auth headers
        response = requests.get(f"{self.base_url}/mcp/status")
        assert response.status_code == 403

        # Invalid auth
        response = requests.get(
            f"{self.base_url}/mcp/status", headers={"Authorization": "Bearer invalid-key"}
        )
        assert response.status_code == 401
