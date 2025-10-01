# Open Edison MCP Proxy Usage Guide

## Overview

Open Edison provides a simple MCP proxy that manages multiple MCP servers as subprocesses and exposes them through a unified HTTP API. This guide covers how to use the proxy to manage and interact with your configured MCP servers.

## Quick Start

### 1. Start the Proxy Server

```bash
# Start Open Edison
make run

# Or run directly
uv run python main.py
```

The MCP protocol server runs at `http://localhost:3000/mcp/` and the management API + dashboard are at `http://localhost:3001`.

### 2. Verify Server Health

```bash
# Check if server is running
curl http://localhost:3001/health

# Response:
{
  "status": "healthy",
  "version": "0.1.0",
  "mcp_servers": 2
}
```

## HTTP API Reference

Most API endpoints require authentication; public endpoints are noted.

```bash
# Authentication header
Authorization: Bearer your-api-key
```

### Server Management

#### GET `/health`

Health check endpoint (no authentication required):

```bash
curl http://localhost:3001/health
```

**Response:**

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "mcp_servers": 2
}
```

#### GET `/mcp/status`

Get configured MCP servers and their enabled flags (public):

```bash
curl http://localhost:3001/mcp/status
```

**Response:**

```json
{
  "servers": [
    { "name": "filesystem", "enabled": true },
    { "name": "github", "enabled": false }
  ]
}
```

### MCP Server Control

#### GET `/mcp/mounted`

List currently mounted servers (auth):

```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/mounted
```

#### POST `/mcp/reinitialize`

Reinitialize servers from the current configuration (auth):

```bash
curl -X POST -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/reinitialize
```

#### POST `/mcp/mount/{server_name}`

Mount a server by name (auth):

```bash
curl -X POST -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/mount/filesystem
```

#### DELETE `/mcp/mount/{server_name}`

Unmount a server by name (auth):

```bash
curl -X DELETE -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/mount/filesystem
```

### MCP Communication

Use an MCP client to connect to the MCP server at `http://localhost:3000/mcp/` (for example `npx -y mcp-remote http://localhost:3000/mcp/ --http-only`). The management API does not proxy JSON-RPC calls.

### Session Logging

#### GET `/sessions`

Get recent MCP session summaries (public):

```bash
curl http://localhost:3001/sessions
```

## MCP Server Management

### Server Lifecycle

1. **Configuration**: Define servers in `config.json`
2. **Initialization**: FastMCP initializes servers on startup
3. **Manual Control**: Mount/unmount servers via API
4. **Monitoring**: Check mounted servers and status endpoints

### Process Management

Open Edison manages MCP servers as subprocesses:

```python
# Example of what happens internally
process = subprocess.Popen([
    "uvx", "mcp-server-filesystem", "/path"
], 
stdin=subprocess.PIPE,
stdout=subprocess.PIPE,
stderr=subprocess.PIPE,
text=True
)
```

### Server States

- **Enabled**: Server is configured to auto-start
- **Disabled**: Server is configured but won't auto-start
- **Running**: Server process is active
- **Stopped**: Server process is not running

## Configuration Examples

### Basic Filesystem Server

```json
{
  "name": "documents",
  "command": "uvx",
  "args": ["mcp-server-filesystem", "/home/user/documents"],
  "enabled": true
}
```

### GitHub Integration

```json
{
  "name": "github",
  "command": "uvx",
  "args": ["mcp-server-github"],
  "env": {
    "GITHUB_TOKEN": "ghp_your_token_here"
  },
  "enabled": true
}
```

### Custom Python MCP Server

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_mcp_package"],
  "env": {
    "DATABASE_URL": "sqlite:///app.db",
    "API_KEY": "secret"
  },
  "enabled": false
}
```

## Programming Examples

### Python Client

```python
import asyncio
import aiohttp

async def manage_mcp_servers():
    headers = {
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json"
    }
    
    async with aiohttp.ClientSession() as session:
        # Check server health
        async with session.get("http://localhost:3001/health") as resp:
            health = await resp.json()
            print(f"Server status: {health['status']}")
        
        # Get configured servers
        async with session.get(
            "http://localhost:3001/mcp/status"
        ) as resp:
            status = await resp.json()
            print("Configured servers:")
            for server in status['servers']:
                print(f"- {server['name']} (enabled={server['enabled']})")

        # Mount a server
        async with session.post(
            "http://localhost:3001/mcp/mount/filesystem",
            headers=headers
        ) as resp:
            result = await resp.json()
            print(f"Mount result: {result}")

asyncio.run(manage_mcp_servers())
```

### JavaScript/Node.js Client

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:3001';
const headers = {
  'Authorization': 'Bearer your-api-key',
  'Content-Type': 'application/json'
};

async function manageMCPServers() {
  try {
    // Check health
    const health = await axios.get(`${API_BASE}/health`);
    console.log('Server status:', health.data.status);
    
    // Get configured servers
    const status = await axios.get(`${API_BASE}/mcp/status`);
    console.log('Configured servers:');
    status.data.servers.forEach(server => {
      console.log(`- ${server.name} (enabled=${server.enabled})`);
    });

    // Mount filesystem server
    const mount = await axios.post(
      `${API_BASE}/mcp/mount/filesystem`, 
      {}, 
      { headers }
    );
    console.log('Mount result:', mount.data);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

manageMCPServers();
```

### Shell Script

```bash
#!/bin/bash

API_KEY="your-api-key"
BASE_URL="http://localhost:3001"

# Function to make authenticated requests
api_call() {
    curl -s -H "Authorization: Bearer $API_KEY" \
         -H "Content-Type: application/json" \
         "$@"
}

# Check health
echo "Checking server health..."
curl -s "$BASE_URL/health" | jq .

# Get server status
echo "Getting MCP server status..."
api_call "$BASE_URL/mcp/status" | jq .

# Mount filesystem server
echo "Mounting filesystem server..."
api_call -X POST "$BASE_URL/mcp/mount/filesystem" | jq .

# Check mounted
echo "Getting mounted servers..."
api_call "$BASE_URL/mcp/mounted" | jq .
```

## Use Cases

### 1. Development Environment

Set up multiple MCP servers for development:

```bash
# Start Open Edison
make run

# Start development servers
curl -X POST -H "Authorization: Bearer dev-key" \
     http://localhost:3001/mcp/filesystem/start

curl -X POST -H "Authorization: Bearer dev-key" \
     http://localhost:3001/mcp/test-tools/start
```

### 2. Selective Server Management

Enable only the servers you need:

```python
import aiohttp

async def enable_work_servers():
    headers = {"Authorization": "Bearer work-api-key"}
    
    # Mount work-related servers
    work_servers = ["github", "documents", "slack-integration"]
    
    async with aiohttp.ClientSession() as session:
        for server in work_servers:
            async with session.post(
                f"http://localhost:3001/mcp/mount/{server}",
                headers=headers
            ) as resp:
                result = await resp.json()
                print(f"Mounted {server}: {result}")
```

### 3. Server Health Monitoring

Monitor server health and restart if needed:

```python
import asyncio
import aiohttp

async def monitor_servers():
    headers = {"Authorization": "Bearer monitor-key"}
    
    while True:
        async with aiohttp.ClientSession() as session:
            # Check status
            async with session.get(
                "http://localhost:3001/mcp/status",
                headers=headers
            ) as resp:
                status = await resp.json()
                
                for server in status['servers']:
                    # Example: ensure critical servers are mounted
                    if server['enabled'] and server['name'] == 'filesystem':
                        await session.post(
                            f"http://localhost:3001/mcp/mount/{server['name']}",
                            headers=headers
                        )
        
        await asyncio.sleep(30)  # Check every 30 seconds

asyncio.run(monitor_servers())
```

## Troubleshooting

### Common Issues

1. **Server Won't Start**

   ```bash
   # Check if command exists
   which uvx
   
   # Check configuration load
   python -c "from src.config import Config; print(Config().mcp_servers[0].command)"
   
   # Check logs
   tail -f server.log
   ```

2. **Authentication Errors**

   ```bash
   # Verify API key
   grep api_key config.json
   
   # Test with correct key
   curl -H "Authorization: Bearer correct-key" http://localhost:3001/mcp/status
   ```

3. **Port Conflicts**

   ```bash
   # Check if port is in use
   lsof -i :3001
   
   # Change port in config.json
   {"server": {"port": 3001}}
   ```

4. **MCP Server Crashes**

   ```bash
   # Check server status
   curl -H "Authorization: Bearer api-key" http://localhost:3001/mcp/status
   
   # Remount server by name
   curl -X POST -H "Authorization: Bearer api-key" \
        http://localhost:3001/mcp/mount/server-name
   ```

### Debug Mode

Enable debug logging to see detailed information:

```json
{
  "logging": {
    "level": "DEBUG"
  }
}
```

### Process Debugging

Check what MCP server processes are running:

```bash
# Find Open Edison process
ps aux | grep "python main.py"

# Find MCP server subprocesses
ps aux | grep mcp-server
```

## Future Features

### Planned Enhancements

1. **Session Logging**: SQLite-based request/response logging
2. **Process Monitoring**: Automatic restart of crashed servers
3. **Configuration Hot Reload**: Update config without restart

### Integration Points

- **FastMCP Client**: Direct integration for tool calls
- **Web Frontend**: Management interface

## Next Steps

1. **[API Reference](../quick-reference/api_reference.md)** - Complete API documentation
2. **[Development Guide](../development/development_guide.md)** - Contributing to Open Edison
3. **[Docker Deployment](../deployment/docker.md)** - Container-based deployment
