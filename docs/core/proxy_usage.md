# Open Edison MCP Proxy Usage Guide

## Overview

Open Edison provides a simple MCP proxy that manages multiple MCP servers as subprocesses and exposes them through a unified HTTP API. This guide covers how to use the proxy to manage and interact with your configured MCP servers.

## Quick Start

### 1. Start the Proxy Server

```bash
# Start Open Edison
make run

# Or run directly
rye run python main.py
```

The server starts on `localhost:3001` with:

- **MCP Proxy**: Will proxy MCP calls (future implementation)

And api on `localhost:3001`

- **FastAPI**: REST endpoints for management

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

All API endpoints require authentication except `/health`:

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

Get status of all configured MCP servers:

```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/status
```

**Response:**

```json
{
  "servers": [
    {
      "name": "filesystem",
      "enabled": true,
      "running": true
    },
    {
      "name": "github",
      "enabled": false,
      "running": false
    }
  ]
}
```

### MCP Server Control

#### POST `/mcp/{server_name}/start`

Start a specific MCP server:

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/filesystem/start
```

**Response:**

```json
{
  "message": "Server filesystem started successfully"
}
```

#### POST `/mcp/{server_name}/stop`

Stop a specific MCP server:

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/filesystem/stop
```

**Response:**

```json
{
  "message": "Server filesystem stopped successfully"
}
```

### MCP Communication

#### POST `/mcp/call`

Proxy MCP calls to running servers (currently placeholder):

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"method": "tools/list", "id": 1}' \
     http://localhost:3001/mcp/call
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "message": "MCP request handling not yet implemented",
    "request": {"method": "tools/list", "id": 1}
  }
}
```

### Session Logging

#### GET `/sessions`

Get session logs (placeholder for future SQLite implementation):

```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/sessions
```

**Response:**

```json
{
  "sessions": [],
  "message": "Session logging not yet implemented"
}
```

## MCP Server Management

### Server Lifecycle

1. **Configuration**: Define servers in `config.json`
2. **Auto-start**: Enabled servers start automatically
3. **Manual Control**: Start/stop servers via API
4. **Health Monitoring**: Check server status
5. **Process Management**: Servers run as subprocesses

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
        
        # Get MCP server status
        async with session.get(
            "http://localhost:3001/mcp/status",
            headers=headers
        ) as resp:
            status = await resp.json()
            print("MCP Servers:")
            for server in status['servers']:
                print(f"- {server['name']}: {'running' if server['running'] else 'stopped'}")
        
        # Start a server
        async with session.post(
            "http://localhost:3001/mcp/filesystem/start",
            headers=headers
        ) as resp:
            result = await resp.json()
            print(f"Start result: {result['message']}")

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
    
    // Get server status
    const status = await axios.get(`${API_BASE}/mcp/status`, { headers });
    console.log('MCP Servers:');
    status.data.servers.forEach(server => {
      console.log(`- ${server.name}: ${server.running ? 'running' : 'stopped'}`);
    });
    
    // Start filesystem server
    const start = await axios.post(
      `${API_BASE}/mcp/filesystem/start`, 
      {}, 
      { headers }
    );
    console.log('Start result:', start.data.message);
    
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

# Start filesystem server
echo "Starting filesystem server..."
api_call -X POST "$BASE_URL/mcp/filesystem/start" | jq .

# Check status again
echo "Checking status after start..."
api_call "$BASE_URL/mcp/status" | jq '.servers[] | select(.name=="filesystem")'
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
    
    # Start work-related servers
    work_servers = ["github", "documents", "slack-integration"]
    
    async with aiohttp.ClientSession() as session:
        for server in work_servers:
            async with session.post(
                f"http://localhost:3001/mcp/{server}/start",
                headers=headers
            ) as resp:
                result = await resp.json()
                print(f"Started {server}: {result['message']}")
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
                    if server['enabled'] and not server['running']:
                        print(f"Restarting {server['name']}...")
                        await session.post(
                            f"http://localhost:3001/mcp/{server['name']}/start",
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
   
   # Check configuration
   python -c "from src.config import config; print(config.mcp_servers[0].command)"
   
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
   
   # Restart crashed server
   curl -X POST -H "Authorization: Bearer api-key" \
        http://localhost:3001/mcp/server-name/start
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
