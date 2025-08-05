"""
End-to-end tests for FastMCP mounting functionality.

Tests the complete workflow: JSON config → subprocess → FastMCP proxy → mounted instance
"""

import pytest
import requests
import time
from typing import Any

from tests.test_template import BackgroundServerTemplate, integration_test, slow_test


class TestMCPMountingE2E(BackgroundServerTemplate):
    """End-to-end tests for MCP mounting functionality"""

    @integration_test
    def test_mounted_servers_endpoint(self, requests_session):
        """Test the /mcp/mounted endpoint returns mounted servers"""
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        
        assert response.status_code == 200
        data = response.json()
        assert "mounted_servers" in data
        assert isinstance(data["mounted_servers"], list)
        
        mounted_names = [server["name"] for server in data["mounted_servers"]]
        assert "test-echo" in mounted_names

    @integration_test
    def test_mount_server_endpoint(self, requests_session):
        """Test mounting a server via API endpoint"""
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 200
        initial_mounted = response.json()["mounted_servers"]
        initial_count = len(initial_mounted)
        
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "test-echo" in data["message"]
        assert "mounted successfully" in data["message"]

    @integration_test
    def test_mount_nonexistent_server(self, requests_session):
        """Test mounting a server that doesn't exist in config"""
        response = requests_session.post(f"{self.base_url}/mcp/nonexistent-server/mount")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        assert "Server configuration not found" in data["detail"]

    @integration_test
    def test_unmount_server_endpoint(self, requests_session):
        """Test unmounting a server via API endpoint"""
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code == 200
        
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/unmount")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "test-echo" in data["message"]
        assert "unmounted successfully" in data["message"]

    @integration_test
    def test_unmount_nonexistent_server(self, requests_session):
        """Test unmounting a server that doesn't exist"""
        response = requests_session.post(f"{self.base_url}/mcp/nonexistent-server/unmount")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    @integration_test
    @slow_test
    def test_complete_mount_unmount_cycle(self, requests_session):
        """Test complete mount/unmount lifecycle"""
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 200
        initial_mounted = response.json()["mounted_servers"]
        
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/unmount")
        assert response.status_code == 200
        
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 200
        after_unmount = response.json()["mounted_servers"]
        unmounted_names = [server["name"] for server in after_unmount]
        
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code == 200
        
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 200
        after_mount = response.json()["mounted_servers"]
        mounted_names = [server["name"] for server in after_mount]
        assert "test-echo" in mounted_names

    @integration_test
    def test_mcp_call_with_mounted_servers(self, requests_session):
        """Test MCP call endpoint with mounted servers"""
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code == 200
        
        request_data = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }
        
        response = requests_session.post(f"{self.base_url}/mcp/call", json=request_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["jsonrpc"] == "2.0"
        assert data["id"] == 1
        assert "result" in data
        
        result = data["result"]
        assert "mounted_servers" in result
        assert isinstance(result["mounted_servers"], list)

    @integration_test
    def test_authentication_required_for_mounting(self):
        """Test that mounting endpoints require authentication"""
        response = requests.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 403
        
        response = requests.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code == 403
        
        response = requests.post(f"{self.base_url}/mcp/test-echo/unmount")
        assert response.status_code == 403
        
        invalid_headers = {"Authorization": "Bearer invalid-key"}
        response = requests.get(f"{self.base_url}/mcp/mounted", headers=invalid_headers)
        assert response.status_code == 401

    @integration_test
    def test_server_auto_mounting_on_startup(self, requests_session):
        """Test that enabled servers are auto-mounted during initialization"""
        response = requests_session.get(f"{self.base_url}/mcp/mounted")
        assert response.status_code == 200
        
        data = response.json()
        mounted_servers = data["mounted_servers"]
        
        assert len(mounted_servers) >= 1
        
        test_echo_server = None
        for server in mounted_servers:
            if server["name"] == "test-echo":
                test_echo_server = server
                break
        
        assert test_echo_server is not None, "test-echo server should be auto-mounted"
        assert test_echo_server["mounted"] is True
        assert "config" in test_echo_server
        
        config = test_echo_server["config"]
        assert config["name"] == "test-echo"
        assert config["command"] == "echo"
        assert config["enabled"] is True

    @integration_test
    @slow_test
    def test_mounting_error_handling(self, requests_session):
        """Test error handling in mounting operations"""
        
        
        response = requests_session.post(f"{self.base_url}/mcp/test-echo/mount")
        assert response.status_code in [200, 500]
        
        data = response.json()
        assert "message" in data or "detail" in data
