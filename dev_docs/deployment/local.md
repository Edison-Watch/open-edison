# Local Installation

## Overview

This guide covers installing and running Open Edison directly on your local machine without Docker. This is ideal for development, testing, and lightweight production deployments.

## Prerequisites

### Required Software

- **Python 3.12+**
- **Rye** (recommended) or **pip/venv**
- **Git** for cloning the repository

### Optional Dependencies

- **uvx** for running MCP servers
- **Node.js** for npm-based MCP servers
- **Docker** for containerized MCP servers

## Installation

### 1. Clone Repository

```bash
# Clone the repository
git clone https://github.com/Edison-Watch/open-edison.git
cd open-edison
```

### 2. Install Dependencies

#### Using UV (Recommended)

```bash
# Install UV if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies
uv sync
```

#### Using pip/venv

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.lock
```

### 3. Initial Setup

```bash
# Create default configuration
make setup

# Or manually
python -c "from src.config import Config; cfg=Config(); cfg.create_default(); cfg.save()"
```

### 4. Configure

Edit `config.json` to customize your setup:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "change-this-secure-key"
  },
  "mcp_servers": [
    {
      "name": "filesystem",
      "command": "uvx",
      "args": ["mcp-server-filesystem", "/path/to/your/directory"],
      "enabled": true
    }
  ]
}
```

### 5. Run Server

```bash
# Start the server
make run

# Or run directly
python main.py
```

## Quick Commands

### Development Workflow

```bash
# Install dependencies
make sync

# Setup configuration
make setup

# Run the server
make run

# Run tests
make test

# Lint and format code
make lint
make format

# Full CI check
make ci
```

### Server Management

```bash
# Start server
make run

# Health check (API)
curl http://localhost:3001/health

# Check MCP server status (public)
curl http://localhost:3001/mcp/status
```

## Configuration

### Basic Configuration

Minimal `config.json`:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "your-secure-api-key"
  },
  "logging": {
    "level": "INFO"
  },
  "mcp_servers": []
}
```

### MCP Server Examples

#### Filesystem Access

```json
{
  "name": "documents",
  "command": "uvx",
  "args": ["mcp-server-filesystem", "/home/user/documents"],
  "enabled": true
}
```

#### GitHub Integration

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

#### Custom Python MCP

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_mcp_package"],
  "env": {
    "API_KEY": "secret",
    "DATABASE_URL": "sqlite:///data.db"
  },
  "enabled": false
}
```

## Environment Setup

Create `.env` file (optional, for future use):

```bash
# API Configuration
OPEN_EDISON_API_KEY=dev-api-key-for-testing

# Logging
OPEN_EDISON_LOG_LEVEL=DEBUG

# External API Keys
GITHUB_TOKEN=your-github-token
SMITHERY_API_KEY=your-smithery-key
```

### API Key Security

```bash
# Generate secure API key
openssl rand -base64 32

# Store in configuration
{
  "server": {
    "api_key": "generated-key-here"
  }
}
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**

   ```bash
   # Find what's using port 3000
   lsof -i :3000
   
   # Change port in config.json
   {"server": {"port": 3001}}
   ```

2. **Permission Denied**

   ```bash
   # Check file permissions
   ls -la config.json
   
   # Fix permissions
   chmod 600 config.json
   ```

3. **Python Version Issues**

   ```bash
   # Check Python version
   python --version
   
   # Use specific Python version
   python3.12 main.py
   ```

### Debug Mode

Enable debug logging:

```json
{
  "logging": {
    "level": "DEBUG"
  }
}
```

## Next Steps

- **[Docker Deployment](docker.md)** - Container-based deployment
- **[Configuration Guide](../core/configuration.md)** - Detailed configuration options
