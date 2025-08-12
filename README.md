# Open Edison

Open-source MCP security gateway that prevents data exfiltration—via direct access or tool chaining—with full monitoring for local single‑user deployments. Provides core functionality of <https://edison.watch> for local, single-user use.

Run locally with uvx: `uvx open-edison --config-dir ~/edison-config`

## Features

- **Single-user MCP proxy** - No multi-user complexity, just a simple proxy for your MCP servers
- **JSON configuration** - Easy to configure and manage your MCP servers
- **Simple local frontend** - Track and monitor your MCP interactions, servers, and sessions.
- **Session tracking** - Track and monitor your MCP interactions
- **Simple API** - REST API for managing MCP servers and proxying requests
- **Docker support** - Run in a container for easy deployment

## Quick Start

### Install from PyPI

#### Prerequisites

- Pipx/uvx

```bash
# Using uvx
uvx open-edison --help

# Using pipx
pipx install open-edison
open-edison --help
```

Run with a custom config directory:

```bash
open-edison run --config-dir ~/edison-config
# or via environment variable
OPEN_EDISON_CONFIG_DIR=~/edison-config open-edison run
```

### Run from source

1. Clone the repository:

```bash
git clone https://github.com/GatlingX/open-edison.git
cd open-edison
```

2. Set up the project:

```bash
make setup
```

3. Edit `config.json` to configure your MCP servers:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "your-secure-api-key"
  },
  "mcp_servers": [
    {
      "name": "filesystem",
      "command": "uvx",
      "args": ["mcp-server-filesystem", "/path/to/directory"],
      "enabled": true
    }
  ]
}
```

4. Run the server:

```bash
make run
# or, from the installed package
open-edison run
```

The server will be available at `http://localhost:3000`.

### Run with Docker

```bash
# After cloning the repo
make run_docker
```

The MCP server will be available at `http://localhost:3000` and the api + frontend at `http://localhost:3001`.

## MCP Connection

Connect any MCP client to Open Edison:

```bash
npx -y mcp-remote http://localhost:3000/mcp/ --http-only --header "Authorization: Bearer your-api-key"
```

Or add to your MCP client config:

```json
{
  "mcpServers": {
    "open-edison": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp/", "--http-only", "--header", "Authorization: Bearer your-api-key"]
    }
  }
}
```

## Usage

### API Endpoints

Api is on port 3001 (or configured MCP server port + 1).

- `GET /health` - Health check
- `GET /mcp/status` - Get status of configured MCP servers
- `POST /mcp/{server_name}/start` - Start a specific MCP server
- `POST /mcp/{server_name}/stop` - Stop a specific MCP server
- `POST /mcp/call` - Proxy MCP calls to running servers
- `GET /sessions` - Get session logs (coming soon)

All endpoints except `/health` require the `Authorization: Bearer <api_key>` header.

## Development

```bash
# Install dependencies
make sync

# Run with auto-reload
make dev

# Run tests
make test

# Lint code
make lint

# Format code
make format
```

### Website (Sessions Dashboard)

A minimal React + Vite frontend is included at `open-edison/frontend/`.

Run it with a single command from the repo root or via the CLI:

```bash
make website
# or
open-edison website
```

This will install frontend deps (first run) and start the dev server. Open the URL shown (typically `http://localhost:5173` or `5174`).

Notes:

- The dashboard reads session data directly from the SQLite database `edison.db` in the repo root via sql.js.
- The Configs tab provides JSON editors (with syntax highlighting) for `config.json`, `tool_permissions.json`, `resource_permissions.json`, and `prompt_permissions.json`.
- You can Save changes directly while the dev server is running; writes are constrained to the project root.

## Docker

```bash
# Build Docker image
make docker_build

# Run in Docker
make docker_run
```

## Configuration

The `config.json` file contains all configuration:

- `server.host` - Server host (default: localhost)
- `server.port` - Server port (default: 3000)
- `server.api_key` - API key for authentication
- `logging.level` - Log level (DEBUG, INFO, WARNING, ERROR)
- `mcp_servers` - Array of MCP server configurations

Each MCP server configuration includes:

- `name` - Unique name for the server
- `command` - Command to run the MCP server
- `args` - Arguments for the command
- `env` - Environment variables (optional)
- `enabled` - Whether to auto-start this server

## Security & Permissions System

Open Edison includes a comprehensive security monitoring system that tracks the "lethal trifecta" of AI agent risks:

1. **Private data access** - Access to sensitive local files/data
2. **Untrusted content exposure** - Exposure to external/web content  
3. **External communication** - Ability to write/send data externally

The system monitors these risks across **tools**, **resources**, and **prompts** using separate configuration files.

### Tool Permissions (`tool_permissions.json`)

Defines security classifications for MCP tools. Each tool is classified with three boolean flags:

```json
{
  "filesystem_read_file": {
    "write_operation": false,
    "read_private_data": true,
    "read_untrusted_public_data": false
  },
  "sqlite_create_record": {
    "write_operation": true,
    "read_private_data": true,
    "read_untrusted_public_data": false
  }
}
```

### Resource Permissions (`resource_permissions.json`)

Defines security classifications for resource access patterns. Currently empty - add classifications as needed:

```json
{
  "_metadata": {
    "description": "Resource security classifications for Open Edison data access tracker",
    "last_updated": "2025-08-07"
  },
  "file:*": {
    "write_operation": false,
    "read_private_data": true,
    "read_untrusted_public_data": false
  },
  "http:*": {
    "write_operation": false,
    "read_private_data": false,
    "read_untrusted_public_data": true
  },
  "database:*": {
    "write_operation": false,
    "read_private_data": true,
    "read_untrusted_public_data": false
  }
}
```

### Prompt Permissions (`prompt_permissions.json`)

Defines security classifications for prompt types. Currently empty - add classifications as needed:

```json
{
  "_metadata": {
    "description": "Prompt security classifications for Open Edison data access tracker", 
    "last_updated": "2025-08-07"
  },
  "system": {
    "write_operation": false,
    "read_private_data": false,
    "read_untrusted_public_data": false
  },
  "external_prompt": {
    "write_operation": false,
    "read_private_data": false,
    "read_untrusted_public_data": true
  },
  "prompt:file:*": {
    "write_operation": false,
    "read_private_data": true,
    "read_untrusted_public_data": false
  }
}
```

### Wildcard Patterns

All permission types support wildcard patterns:

- **Tools**: `server_name/*` (e.g., `filesystem/*` matches all filesystem tools)
- **Resources**: `scheme:*` (e.g., `file:*` matches all file resources)  
- **Prompts**: `type:*` (e.g., `template:*` matches all template prompts)

### Security Monitoring

**All items must be explicitly configured** - unknown tools/resources/prompts will be rejected for security.

Use the `get_security_status` tool to monitor your session's current risk level and see which capabilities have been accessed. When the lethal trifecta is achieved (all three risk flags set), further potentially dangerous operations are blocked.

## Documentation

📚 **Complete documentation available in [`docs/`](docs/)**

- **[Getting Started](docs/quick-reference/config_quick_start.md)** - Quick setup guide
- **[Configuration](docs/core/configuration.md)** - Complete configuration reference
- **[API Reference](docs/quick-reference/api_reference.md)** - REST API documentation
- **[Development Guide](docs/development/development_guide.md)** - Contributing and development

## License

GPL-3.0 License - see [LICENSE](LICENSE) for details.
