# Open Edison Configuration Guide

## Overview

Open Edison uses a simple JSON-based configuration system designed for single-user deployment. No database setup required - everything is configured through a single `config.json` file.

## Configuration Structure

### Main Configuration File (`config.json`)

The complete configuration structure:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "dev-api-key-change-me"
  },
  "logging": {
    "level": "INFO",
    "database_path": "sessions.db"
  },
  "mcp_servers": [
    {
      "name": "filesystem",
      "command": "uvx",
      "args": ["mcp-server-filesystem", "/tmp"],
      "env": {
        "CUSTOM_VAR": "value"
      },
      "enabled": true
    },
    {
      "name": "github",
      "command": "uvx", 
      "args": ["mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "your-github-token"
      },
      "enabled": false
    }
  ]
}
```

## Configuration Sections

Described in [project structure](project_structure.md) / actual config model file, [src/config.py](../../src/config.py)

## MCP Server Examples

### Filesystem MCP Server

Access local filesystem through MCP:

```json
{
  "name": "filesystem",
  "command": "uvx",
  "args": ["mcp-server-filesystem", "/home/user/documents"],
  "env": {},
  "enabled": true
}
```

### GitHub MCP Server

GitHub API integration:

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

Your own MCP server implementation:

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_mcp_package"],
  "env": {
    "API_KEY": "secret-key",
    "DATABASE_URL": "sqlite:///data.db"
  },
  "enabled": true
}
```

### Smithery MCP Server

Weather and other services from Smithery.ai:

```json
{
  "name": "smithery-weather",
  "command": "npx",
  "args": ["-y", "@smithery/mcp-server-smithery"],
  "env": {
    "SMITHERY_API_KEY": "your-smithery-key"
  },
  "enabled": true
}
```

## Configuration Management

### Auto-Generation

If `config.json` doesn't exist, Open Edison creates a default configuration:

```bash
make setup
# or
python -c "from src.config import Config; cfg=Config(); cfg.create_default(); cfg.save()"
```

### Validation

Configuration is validated on startup using Python dataclasses:

```python
from src.config import Config

# Load and validate configuration
config = Config()
print(f"Server will run on {config.server.host}:{config.server.port}")
```

### Configuration Reload

Changes to `config.json` require a server restart:

```bash
# Edit config.json
vim config.json

# Restart server
make run
```

Later on this will be doable via the API

### Configuration Directory

By default, configuration is loaded from a platform-appropriate config directory. You can override the location using `OPEN_EDISON_CONFIG_DIR`.

Resolution order:

1. `OPEN_EDISON_CONFIG_DIR` environment variable, if set
2. OS-specific defaults (e.g., `~/Library/Application Support/Open Edison` on macOS, `$XDG_CONFIG_HOME/open-edison` on Linux)
3. Fallback to `~/.open-edison`

### Telemetry

Open Edison can emit basic telemetry metrics.

```json
{
  "telemetry": {
    "enabled": true,
    "otlp_endpoint": "https://otel-collector-production-e7a6.up.railway.app/v1/metrics",
    "headers": { "x-auth": "token" },
    "export_interval_ms": 60000
  }
}
```

- `enabled`: Toggle telemetry on/off
- `otlp_endpoint`: Custom OTLP endpoint (defaults to a hosted collector if not set)
- `headers`: Optional headers for the exporter
- `export_interval_ms`: Export interval in milliseconds

## Security Considerations

### API Key Security

- **Change Default Key**: Never use `"dev-api-key-change-me"` in production
- **Strong Keys**: Use long, random strings (32+ characters)
- **Secure Storage**: Keep `config.json` readable only by the server user

```bash
# Generate secure API key
openssl rand -base64 32

# Set file permissions
chmod 600 config.json
```

### MCP Server Security

- **Environment Variables**: Store sensitive data (API keys, tokens) in `env` section
- **Command Validation**: Only run trusted MCP server commands
- **Network Access**: Consider firewall rules for MCP server network access

## Configuration Patterns

### Development Setup

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "dev-key-for-testing"
  },
  "logging": {
    "level": "DEBUG"
  },
  "mcp_servers": [
    {
      "name": "test-filesystem",
      "command": "uvx",
      "args": ["mcp-server-filesystem", "/tmp/test"],
      "enabled": true
    }
  ]
}
```

## More docs

1. **[MCP Proxy Usage](proxy_usage.md)** - Learn how to use configured MCP servers
2. **[API Reference](../quick-reference/api_reference.md)** - Complete API documentation
3. **[Development Guide](../development/development_guide.md)** - Contributing to Open Edison
