# OpenEdison

Open-source single-user MCP security gateway that prevents data exfiltration—via direct access or tool chaining—with full monitoring for local single‑user deployments. Provides core functionality of <https://edison.watch> for local use.

<div align="center">
  <h2>📧 Interested in connecting AI to your business software with proper access controls? <a href="mailto:hello@edison.watch">Contact us</a> to discuss.</h2>
</div>

## Features

- **Single-user MCP proxy** - No multi-user complexity, just a simple proxy for your MCP servers
- **JSON configuration** - Easy to configure and manage your MCP servers
- **Simple local frontend** - Track and monitor your MCP interactions, servers, and sessions.
- **Session tracking** - Track and monitor your MCP interactions
- **Simple API** - REST API for managing MCP servers and proxying requests
- **Docker support** - Run in a container for easy deployment

## Quick Start

The fastest way to get started:

```bash
# Installs uv (via Astral installer) and launches open-edison with uvx.
# Note: This does NOT install Node/npx. Install Node if you plan to use npx-based tools like mcp-remote.
curl -fsSL https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh | bash
```

Run locally with uvx: `uvx open-edison --config-dir ~/edison-config`

<details>
<summary>Install Node.js/npm (optional for MCP tools)</summary>

If you need `npx` (for Node-based MCP tools like `mcp-remote`), install Node.js as well:

![macOS](https://img.shields.io/badge/mac%20os-000000?style=for-the-badge&logo=apple&logoColor=white)

- uv: `curl -fsSL https://astral.sh/uv/install.sh | sh`
- Node/npx: `brew install node`

![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)

- uv: `curl -fsSL https://astral.sh/uv/install.sh | sh`
- Node/npx: `sudo apt-get update && sudo apt-get install -y nodejs npm`

![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

- uv: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
- Node/npx: `winget install -e --id OpenJS.NodeJS`

After installation, ensure that `npx` is available on PATH.

<details>
<summary><img src="https://img.shields.io/badge/pypi-3775A9?style=for-the-badge&logo=pypi&logoColor=white" alt="PyPI"> Install from PyPI</summary>

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

</details>

<details>
<summary><img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"> Run with Docker</summary>

There is a dockerfile for simple local setup.

```bash
# Single-line:
git clone https://github.com/GatlingX/open-edison.git && cd open-edison && make docker_run

# Or
# Clone repo
git clone https://github.com/GatlingX/open-edison.git
# Enter repo
cd open-edison
# Build and run
make docker_run
```

The MCP server will be available at `http://localhost:3000` and the api + frontend at `http://localhost:3001`.

</details>

<details>
<summary>⚙️ Run from source</summary>

1. Clone the repository:

```bash
git clone https://github.com/GatlingX/open-edison.git
cd open-edison
```

1. Set up the project:

```bash
make setup
```

1. Edit `config.json` to configure your MCP servers. See the full file: [config.json](config.json), it looks like:

```json
{
  "server": { "host": "0.0.0.0", "port": 3000, "api_key": "..." },
  "logging": { "level": "INFO", "database_path": "sessions.db" },
  "mcp_servers": [
    { "name": "filesystem", "command": "uvx", "args": ["mcp-server-filesystem", "/tmp"], "enabled": true },
    { "name": "github", "enabled": false, "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." } }
  ]
}
```

1. Run the server:

```bash
make run
# or, from the installed package
open-edison run
```

The server will be available at `http://localhost:3000`.

</details>

<details>
<summary>MCP Connection</summary>

Connect any MCP client to Open Edison (requires Node.js/npm for `npx`):

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

</details>

<details>
<summary>Usage</summary>

### API Endpoints

See [API Reference](docs/quick-reference/api_reference.md) for full API documentation.

<details>
<summary>Development</summary>

### Setup

Setup from source as above.

### Run

Server doesn't have any auto-reload at the moment, so you'll need to run & ctrl-c this during development.

```bash
make run
```

### Tests/code quality

We expect `make ci` to return cleanly.

```bash
make ci
```

</details>

<details>
<summary>⚙️ Configuration (config.json)</summary>

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

</details>

</details>

<details>
<summary>Security & Permissions System</summary>

Open Edison includes a comprehensive security monitoring system that tracks the "lethal trifecta" of AI agent risks, as described in [Simon Willison's blog post](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/):

<img src="media/lethal-trifecta.png" alt="The lethal trifecta diagram showing the three key AI agent security risks" width="30%">

1. **Private data access** - Access to sensitive local files/data
2. **Untrusted content exposure** - Exposure to external/web content  
3. **External communication** - Ability to write/send data externally

<img src="media/pam-diagram.png" alt="Privileged Access Management (PAM) example showing the lethal trifecta in action" width="60%">

The configuration allows you to classify these risks across **tools**, **resources**, and **prompts** using separate configuration files.

In addition to trifecta, we track Access Control Level (ACL) for each tool call,
that is, each tool has an ACL level (one of PUBLIC, PRIVATE, or SECRET), and we track the highest ACL level for each session.
If a write operation is attempted to a lower ACL level, it is blocked.

### Tool Permissions (`tool_permissions.json`)

Defines security classifications for MCP tools. See full file: [tool_permissions.json](tool_permissions.json), it looks like:

```json
{
  "_metadata": { "last_updated": "2025-08-07" },
  "builtin": {
    "get_security_status": { "enabled": true, "write_operation": false, "read_private_data": false, "read_untrusted_public_data": false, "acl": "PUBLIC" }
  },
  "filesystem": {
    "read_file": { "enabled": true, "write_operation": false, "read_private_data": true, "read_untrusted_public_data": false, "acl": "PRIVATE" },
    "write_file": { "enabled": true, "write_operation": true, "read_private_data": true, "read_untrusted_public_data": false, "acl": "PRIVATE" }
  }
}
```

<details>
<summary>Resource Permissions (`resource_permissions.json`)</summary>

### Resource Permissions (`resource_permissions.json`)

Defines security classifications for resource access patterns. See full file: [resource_permissions.json](resource_permissions.json), it looks like:

```json
{
  "_metadata": { "last_updated": "2025-08-07" },
  "builtin": { "config://app": { "enabled": true, "write_operation": false, "read_private_data": false, "read_untrusted_public_data": false } }
}
```

</details>

<details>
<summary>Prompt Permissions (`prompt_permissions.json`)</summary>

### Prompt Permissions (`prompt_permissions.json`)

Defines security classifications for prompt types. See full file: [prompt_permissions.json](prompt_permissions.json), it looks like:

```json
{
  "_metadata": { "last_updated": "2025-08-07" },
  "builtin": { "summarize_text": { "enabled": true, "write_operation": false, "read_private_data": false, "read_untrusted_public_data": false } }
}
```

</details>

### Wildcard Patterns

All permission types support wildcard patterns:

- **Tools**: `server_name/*` (e.g., `filesystem/*` matches all filesystem tools)
- **Resources**: `scheme:*` (e.g., `file:*` matches all file resources)  
- **Prompts**: `type:*` (e.g., `template:*` matches all template prompts)

### Security Monitoring

**All items must be explicitly configured** - unknown tools/resources/prompts will be rejected for security.

Use the `get_security_status` tool to monitor your session's current risk level and see which capabilities have been accessed. When the lethal trifecta is achieved (all three risk flags set), further potentially dangerous operations are blocked.

</details>

<details>
<summary>Documentation</summary>

📚 **Complete documentation available in [`docs/`](docs/)**

- **[Getting Started](docs/quick-reference/config_quick_start.md)** - Quick setup guide
- **[Configuration](docs/core/configuration.md)** - Complete configuration reference
- **[API Reference](docs/quick-reference/api_reference.md)** - REST API documentation
- **[Development Guide](docs/development/development_guide.md)** - Contributing and development

</details>

<details>
<summary>License</summary>

GPL-3.0 License - see [LICENSE](LICENSE) for details.

</details>
