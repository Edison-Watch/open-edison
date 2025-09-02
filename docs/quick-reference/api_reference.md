# Open Edison API Reference

## Base URL

```
http://localhost:3001
```

## Authentication

Public endpoints: `/health`, `/mcp/status`, `/sessions`.

All other endpoints require API key authentication:

```
Authorization: Bearer <api_key>
```

API key is configured in `config.json`:

```json
{
  "server": {
    "api_key": "your-secure-api-key"
  }
}
```

## Endpoints

### Health Check

#### GET `/health`

Check server health and basic information.

**Authentication**: None required

**Response**:

```json
{
  "status": "healthy",
  "version": "0.1.0", 
  "mcp_servers": 2
}
```

**Status Codes**:

- `200` - Server is healthy

**Example**:

```bash
curl http://localhost:3001/health
```

---

### MCP Server Status (Public)

#### GET `/mcp/status`

Get configured MCP servers and their enabled flags.

**Authentication**: None required

**Response**:

```json
{
  "servers": [
    { "name": "filesystem", "enabled": true },
    { "name": "github", "enabled": false }
  ]
}
```

**Status Codes**:

- `200` - Success
- `401` - Invalid API key

**Example**:

```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/status
```

---

### MCP Server Control

#### GET `/mcp/mounted`

List currently mounted MCP servers.

**Authentication**: Required

**Example**:

```bash
curl -H "Authorization: Bearer your-api-key" http://localhost:3001/mcp/mounted
```

#### POST `/mcp/reinitialize`

Reinitialize servers from the current configuration.

**Authentication**: Required

**Example**:

```bash
curl -X POST -H "Authorization: Bearer your-api-key" http://localhost:3001/mcp/reinitialize
```

#### POST `/mcp/mount/{server_name}`

Mount a server by name.

**Authentication**: Required

**Example**:

```bash
curl -X POST -H "Authorization: Bearer your-api-key" http://localhost:3001/mcp/mount/filesystem
```

#### DELETE `/mcp/mount/{server_name}`

Unmount a server by name.

**Authentication**: Required

**Example**:

```bash
curl -X DELETE -H "Authorization: Bearer your-api-key" http://localhost:3001/mcp/mount/filesystem
```

---

### Session Logs (Public)

#### GET `/sessions`

Return recent MCP session summaries.

**Authentication**: None required

**Example**:

```bash
curl http://localhost:3001/sessions
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "detail": "Error description"
}
```

### Common Error Codes

- **401 Unauthorized**: Invalid or missing API key
- **404 Not Found**: Endpoint or resource not found
- **500 Internal Server Error**: Server error or MCP operation failed

### Authentication Error

```bash
curl -H "Authorization: Bearer invalid-key" \
     http://localhost:3001/mcp/status
# Response: 401 Unauthorized
{
  "detail": "Invalid API key"
}
```

## Rate Limiting

Currently no rate limiting is implemented. For production use, consider implementing rate limiting at the reverse proxy level.

## Client Libraries

### Python Example

```python
import aiohttp
import asyncio

class OpenEdisonClient:
    def __init__(self, base_url="http://localhost:3001", api_key=None):
        self.base_url = base_url
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    
    async def health_check(self):
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base_url}/health") as resp:
                return await resp.json()
    
    async def get_server_status(self):
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.base_url}/mcp/status"
            ) as resp:
                return await resp.json()

# Usage
async def main():
    client = OpenEdisonClient(api_key="your-api-key")
    
    health = await client.health_check()
    print(f"Server status: {health['status']}")
    
    status = await client.get_server_status()
    print(f"MCP servers: {len(status['servers'])}")

asyncio.run(main())
```

### JavaScript Example

```javascript
class OpenEdisonClient {
  constructor(baseUrl = 'http://localhost:3001', apiKey = null) {
    this.baseUrl = baseUrl;
    this.headers = {
      'Content-Type': 'application/json',
      ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
    };
  }

  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  async getServerStatus() {
    const response = await fetch(`${this.baseUrl}/mcp/status`);
    return response.json();
  }

  async mountServer(serverName) {
    const response = await fetch(`${this.baseUrl}/mcp/mount/${serverName}`, {
      method: 'POST',
      headers: this.headers
    });
    return response.json();
  }
}

// Usage
const client = new OpenEdisonClient('http://localhost:3001', 'your-api-key');

client.healthCheck().then(health => {
  console.log('Server status:', health.status);
});

client.getServerStatus().then(status => {
  console.log('MCP servers:', status.servers.length);
});
```

### Shell Script Example

```bash
#!/bin/bash

API_KEY="your-api-key"
BASE_URL="http://localhost:3001"

# Function for authenticated requests
api_call() {
    curl -s -H "Authorization: Bearer $API_KEY" \
         -H "Content-Type: application/json" \
         "$@"
}

# Health check
echo "=== Health Check ==="
curl -s "$BASE_URL/health" | jq .

# Server status (public)
echo -e "\n=== Server Status ==="
curl -s "$BASE_URL/mcp/status" | jq .

# Mount filesystem server
echo -e "\n=== Mounting Filesystem Server ==="
api_call -X POST "$BASE_URL/mcp/mount/filesystem" | jq .
```

## Versioning

The API follows semantic versioning. Breaking changes will result in a new major version. Current version is available via the `/health` endpoint.

## Support

For API questions or issues:

1. Check the [troubleshooting guide](../core/proxy_usage.md#troubleshooting)
2. Review the [development documentation](../development/development_guide.md)
3. Open an issue on GitHub
