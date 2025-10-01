# OpenEdison 🔒⚡️

> The Secure MCP Control Panel

<p> <video src="https://github.com/user-attachments/assets/f64b4659-299f-4ef8-b9f2-a3079c4c1905" alt="Open Edison Announcement Video" width="520">Open Edison Announcement Video</video>

Connect AI to your data/software with additional security controls to help reduce data exfiltration risks. Gain visibility, monitor potential threats, and get alerts on the data your agent is reading/writing.

OpenEdison helps address the [lethal trifecta problem](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), which can increase risks of agent hijacking & data exfiltration by malicious actors.

**Join our Discord** for feedback, feature requests, and to discuss MCP security for your use case: [discord.gg/tXjATaKgTV](https://discord.gg/tXjATaKgTV)

<div align="center">
  <h2>📧 To get visibility, control and exfiltration blocker into AI's interaction with your company software, systems of record, DBs, <a href="mailto:hello@edison.watch">Contact us</a> to discuss.</h2>
</div>

<p align="center">
  <a href="https://discord.gg/tXjATaKgTV"><img alt="Join our Discord" src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white"></a>
  <img alt="Project Version" src="https://img.shields.io/pypi/v/open-edison?label=version&color=blue">
  <img alt="Python Version" src="https://img.shields.io/badge/python-3.12-blue?logo=python">
  <img src="https://img.shields.io/badge/License-GPLv3-blue" alt="License">

</p>

---

## Features ✨

- 🛑 **Data leak monitoring** - Edison detects and blocks potential data leaks through configurable security controls
- 🕰️ **Controlled execution** - Provides structured execution controls to reduce data exfiltration risks.
- 🗂️ **Easily configurable** - Easy to configure and manage your MCP servers
- 📊 **Visibility into agent interactions** - Track and monitor your agents and their interactions with connected software/data via MCP calls
- 🔗 **Simple API** - REST API for managing MCP servers and proxying requests
- 🐳 **Docker support** - Run in a container for easy deployment

<details>
<summary>🤝 Quick integration with LangGraph and other agent frameworks</summary>

Open-Edison integrates with LangGraph, LangChain, and plain Python agents by decorating your tools/functions with <code>@edison.track()</code>. This provides immediate observability and policy enforcement without invasive changes.

<div align="center">
  <h4>🔎 Dataflow observability (LangGraph demo)</h4>
  <img src="media/agent_dataflowgraph_example.gif" alt="Open Edison dataflow observability while running the LangGraph long_running_toolstorm_agent.py demo" width="720">
</div>

<div align="center">
  <h4>⚡️ One-line tool integration</h4>
  <p>Just add <code>@edison.track()</code> to your tools/functions to enable Open-Edison controls and observability.</p>
  <img src="media/agent_integration.gif" alt="Adding @edison.track() to an existing agent or tool" width="720">
</div>

Read more in [docs/langgraph_quickstart.md](docs/quick-reference/langgraph_quickstart.md)

</details>

## About Edison.watch 🏢

Edison helps you gain observability, control, and policy enforcement for AI interactions with systems of records, existing company software and data. Reduce risks of AI-caused data leakage with streamlined setup for cross-system governance.

## Quick Start 🚀

The fastest way to get started:

```bash
# Installs uv (via Astral installer) and launches open-edison with uvx.
# Note: This does NOT install Node/npx. Install Node if you plan to use npx-based tools like mcp-remote.
curl -fsSL https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh | bash
```

Run locally with uvx: `uvx open-edison`
That will run the setup wizard if necessary.

<details>
<summary>⬇️ Install Node.js/npm (optional for MCP tools)</summary>

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
</details>

<details>
<summary><img src="https://img.shields.io/badge/pypi-3775A9?style=for-the-badge&logo=pypi&logoColor=white" alt="PyPI"> Install from PyPI</summary>

#### Prerequisites

- Pipx/uvx

```bash
# Using uvx
uvx open-edison

# Using pipx
pipx install open-edison
open-edison
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
git clone https://github.com/Edison-Watch/open-edison.git && cd open-edison && make docker_run

# Or
# Clone repo
git clone https://github.com/Edison-Watch/open-edison.git
# Enter repo
cd open-edison
# Build and run
make docker_run
```

The MCP server will be available at `http://localhost:3000` and the api + frontend at `http://localhost:3001`. 🌐

</details>

<details>
<summary>⚙️ Run from source</summary>

1. Clone the repository:

```bash
git clone https://github.com/Edison-Watch/open-edison.git
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
  "logging": { "level": "INFO"},
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

The server will be available at `http://localhost:3000`. 🌐

</details>

<details>
<summary>🔌 MCP Connection</summary>

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
<summary>🤖 Connect to ChatGPT (Plus/Pro)</summary>

Open-Edison comes preconfigured with ngrok for easy ChatGPT integration. Follow these steps to connect:

### 1. Set up ngrok Account

1. Visit [https://dashboard.ngrok.com](https://dashboard.ngrok.com) to sign up for a free account
2. Get your authtoken from the "Your Authtoken" page
3. Create a domain name in the "Domains" page
4. Set these values in your `ngrok.yml` file:

```yaml
version: 3

agent:
  authtoken: YOUR_NGROK_AUTH_TOKEN

endpoints:
  - name: open-edison-mcp
    url: https://YOUR_DOMAIN.ngrok-free.app
    upstream:
      url: http://localhost:3000
      protocol: http1
```

### 2. Start ngrok Tunnel

```bash
make ngrok
```

This will start the ngrok tunnel and make Open-Edison accessible via your custom domain.

### 3. Enable Developer Mode in ChatGPT

1. Click on your profile icon in ChatGPT
2. Select **Settings**
3. Go to **"Connectors"** in the settings menu
4. Select **"Advanced Settings"**
5. Enable **"Developer Mode (beta)"**

### 4. Add Open-Edison to ChatGPT

1. Click on your profile icon in ChatGPT
2. Select **Settings**
3. Go to **"Connectors"** in the settings menu
4. Select **"Create"** next to "Browse connections"
5. Set a name (e.g., "Open-Edison")
6. Use your ngrok URL as the MCP Server URL (e.g., `https://your-domain.ngrok-free.app/mcp/`)
7. Select **"No authentication"** in the Authentication menu
8. Tick the **"I trust this application"** checkbox
9. Press **Create**

### 5. Use Open-Edison in ChatGPT

Every time you start a new chat:

1. Click on the plus sign in the prompt text box ("Ask anything")
2. Hover over **"... More"**
3. Click on **"Developer Mode"**
4. **"Developer Mode"** and your connector name (e.g., "Open-Edison") will appear at the bottom of the prompt textbox

You can now use Open-Edison's MCP tools directly in your ChatGPT conversations! Do not forget to repeat step 5 everytime you start a new chat.

</details>

<details>
<summary>🧭 Usage</summary>

### API Endpoints

See [API Reference](docs/quick-reference/api_reference.md) for full API documentation.

<details>
<summary>🛠️ Development</summary>

### Setup 🧰

Setup from source as above.

### Run ▶️

Server doesn't have any auto-reload at the moment, so you'll need to run & ctrl-c this during development.

```bash
make run
```

### Tests/code quality ✅

We expect `make ci` to return cleanly.

```bash
make ci
```

</details>

<details>
<summary>⚙️ Configuration (config.json)</summary>

## Configuration ⚙️

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

## 🔐 How Edison reduces data leakages

<details>
<summary>🔱 The lethal trifecta, agent lifecycle management</summary>

Open Edison includes a comprehensive security monitoring system that tracks the "lethal trifecta" of AI agent risks, as described in [Simon Willison's blog post](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/):

<img src="media/lethal-trifecta.png" alt="The lethal trifecta diagram showing the three key AI agent security risks" width="70%">

1. **Private data access** - Access to sensitive local files/data
2. **Untrusted content exposure** - Exposure to external/web content  
3. **External communication** - Ability to write/send data externally

<img src="media/pam-diagram.png" alt="Privileged Access Management (PAM) example showing the lethal trifecta in action" width="90%">

The configuration allows you to classify these risks across **tools**, **resources**, and **prompts** using separate configuration files.

In addition to trifecta, we track Access Control Level (ACL) for each tool call,
that is, each tool has an ACL level (one of PUBLIC, PRIVATE, or SECRET), and we track the highest ACL level for each session.
If a write operation is attempted to a lower ACL level, it can be blocked based on your configuration.

### 🧰 Tool Permissions (`tool_permissions.json`)

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
<summary>📁 Resource Permissions (`resource_permissions.json`)</summary>

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
<summary>💬 Prompt Permissions (`prompt_permissions.json`)</summary>

### Prompt Permissions (`prompt_permissions.json`)

Defines security classifications for prompt types. See full file: [prompt_permissions.json](prompt_permissions.json), it looks like:

```json
{
  "_metadata": { "last_updated": "2025-08-07" },
  "builtin": { "summarize_text": { "enabled": true, "write_operation": false, "read_private_data": false, "read_untrusted_public_data": false } }
}
```

</details>

### Wildcard Patterns ✨

All permission types support wildcard patterns:

- **Tools**: `server_name/*` (e.g., `filesystem/*` matches all filesystem tools)
- **Resources**: `scheme:*` (e.g., `file:*` matches all file resources)  
- **Prompts**: `type:*` (e.g., `template:*` matches all template prompts)

### Security Monitoring 🕵️

**All items must be explicitly configured** - unknown tools/resources/prompts will be rejected for security.

Use the `get_security_status` tool to monitor your session's current risk level and see which capabilities have been accessed. When the lethal trifecta is achieved (all three risk flags set), further potentially dangerous operations are blocked.

</details>

## Documentation 📚

📚 **Complete documentation available in [`docs/`](docs/)**

- 🚀 **[Getting Started](docs/quick-reference/config_quick_start.md)** - Quick setup guide
- ⚙️ **[Configuration](docs/core/configuration.md)** - Complete configuration reference
- 📡 **[API Reference](docs/quick-reference/api_reference.md)** - REST API documentation
- 🧑‍💻 **[Development Guide](docs/development/development_guide.md)** - Contributing and development

<details>
<summary>📄 License</summary>

GPL-3.0 License - see [LICENSE](LICENSE) for details.

</details>
