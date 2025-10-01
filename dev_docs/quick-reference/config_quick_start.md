# Configuration Quick Start

## ⚡ **Essential Setup**

### 1. Initialize Configuration

```bash
# Create default config.json
make setup

# Or manually
python -c "from src.config import Config; cfg=Config(); cfg.create_default(); cfg.save()"
```

### 2. Basic Configuration

Edit `config.json`:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000,
    "api_key": "your-secure-api-key-here"
  },
  "logging": {
    "level": "INFO"
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

### 3. Start Server

```bash
make run
```

## 🔧 **Common Configurations**

### Filesystem Access

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

### Custom Python MCP

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_mcp_package"],
  "env": {
    "API_KEY": "secret"
  },
  "enabled": false
}
```

## 🛡️ **Security Essentials**

### Change Default API Key

⚠️ **Important**: Change the default API key!

```bash
# Generate secure key
openssl rand -base64 32

# Update config.json
{
  "server": {
    "api_key": "generated-secure-key-here"
  }
}
```

### File Permissions

```bash
# Secure config file
chmod 600 config.json
```

## 🧪 **Test Configuration**

```bash
# Validate config by loading
python -c "from src.config import Config; print('✅ Loaded' if Config() else '❌')"

# Test server
curl http://localhost:3001/health

# Test authentication
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3001/mcp/status
```

## 📝 **Configuration Structure**

| Section | Purpose | Required |
|---------|---------|----------|
| `server` | Server settings & auth | ✅ |
| `logging` | Log configuration | ✅ |
| `mcp_servers` | MCP server definitions | ✅ |

### Server Options

- **`host`**: Bind address (default: `"localhost"`)
- **`port`**: Server port (default: `3000`) (for MCP server, api is on this + 1)
- **`api_key`**: Authentication key (⚠️ change from default)

### MCP Server Options

- **`name`**: Unique server identifier
- **`command`**: Executable to run
- **`args`**: Command line arguments
- **`env`**: Environment variables (optional)
- **`enabled`**: Auto-start on server boot

## 🚀 **Quick Patterns**

### Development Setup

```json
{
  "server": {"port": 3000, "api_key": "dev-key"},
  "logging": {"level": "DEBUG"},
  "mcp_servers": [
    {"name": "test-fs", "command": "uvx", "args": ["mcp-server-filesystem", "/tmp"], "enabled": true}
  ]
}
```

### Production Setup

```json
{
  "server": {"host": "0.0.0.0", "port": 3000, "api_key": "secure-32-char-key"},
  "logging": {"level": "INFO"},
  "mcp_servers": [
    {"name": "workspace", "command": "uvx", "args": ["mcp-server-filesystem", "/data"], "enabled": true}
  ]
}
```

## 🔍 **Troubleshooting**

### Config Validation Failed

```bash
# Check JSON syntax
python -m json.tool config.json

# Check configuration loading
python -c "from src.config import Config; _=Config()"
```

### Server Won't Start

```bash
# Check port availability
lsof -i :3000

# Check command exists
which uvx

# Enable debug logging
{"logging": {"level": "DEBUG"}}
```

### Authentication Issues

```bash
# Verify API key in config
grep api_key config.json

# Test with correct key
curl -H "Authorization: Bearer correct-key" http://localhost:3001/mcp/status
```

## 📚 **Next Steps**

- **[Complete Configuration Guide](../core/configuration.md)** - Detailed configuration options
- **[MCP Proxy Usage](../core/proxy_usage.md)** - Using configured servers
- **[API Reference](api_reference.md)** - Complete API documentation

---

**Quick help**: Run `make help` to see all available commands.
