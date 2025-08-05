# Open Edison

Open-source MCP security, aggregation, and monitoring. Provides core functionality of <https://edison.watch> for local, single-user use.

## Features

- **Single-user MCP proxy** - No multi-user complexity, just a simple proxy for your MCP servers
- **JSON configuration** - Easy to configure and manage your MCP servers
- **Session tracking** - (Coming soon) Track and monitor your MCP interactions
- **Simple API** - REST API for managing MCP servers and proxying requests
- **Docker support** - Run in a container for easy deployment

## Quick Start

### Prerequisites

- Python 3.12+
- [Rye](https://rye-up.com/) for dependency management

### Installation

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
```

The server will be available at `http://localhost:3000`.

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

## Documentation

📚 **Complete documentation available in [`docs/`](docs/)**

- **[Getting Started](docs/quick-reference/config_quick_start.md)** - Quick setup guide
- **[Configuration](docs/core/configuration.md)** - Complete configuration reference
- **[API Reference](docs/quick-reference/api_reference.md)** - REST API documentation
- **[Development Guide](docs/development/development_guide.md)** - Contributing and development

## License

GPL-3.0 License - see [LICENSE](LICENSE) for details.
