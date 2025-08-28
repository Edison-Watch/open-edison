# Open Edison Connector - Desktop Extension

Connect to Open Edison MCP proxy servers from Claude Desktop with one-click setup and secure API key management. This Desktop Extension acts as a user-friendly wrapper for [mcp-remote](https://www.npmjs.com/package/mcp-remote) to connect to your Open Edison single-user MCP proxy.

## Features

- **One-Click Connection**: Easy setup to Open Edison servers
- **Secure Credential Storage**: API keys stored securely in OS keychain
- **Automatic Connection Management**: Handles authentication and reconnection
- **Single-User Focus**: Designed for Open Edison's single-user architecture
- **Zero Configuration**: No manual JSON editing required

## What This Extension Provides

Once connected to your Open Edison server, you get access to all your configured tools:

### Core Open Edison Tools

- **mcp_status**: Get status of configured MCP servers in Open Edison
- **start_mcp_server**: Start a specific MCP server by name
- **stop_mcp_server**: Stop a specific MCP server by name

### Configured MCP Server Tools

Access to all tools from MCP servers you've configured in Open Edison, such as:

- File system operations
- Database queries
- API integrations
- Custom business logic
- And any other MCP servers in your Open Edison configuration

### Resources & Prompts

- **server_help**: Get help information about using Open Edison tools
- Server status monitoring and analytics
- Real-time server health information

## Installation

### For Users

1. **Download** the `open-edison-connector.dxt` file
2. **Open Claude Desktop** application
3. **Go to Settings** → Extensions
4. **Click "Install Extension"** or drag the `.dxt` file into the window
5. **Configure your connection**:
   - **Server URL**: Your Open Edison server MCP endpoint (e.g., `http://localhost:3000/mcp/`)
   - **API Key**: Your Open Edison API key (default for local dev: `dev-api-key-change-me`)
6. **Click "Install"** when prompted
7. **Done!** All your Open Edison tools are now available in Claude Desktop

### Server URL

- `http://localhost:3000/mcp/`

## Configuration

### Required Settings

- **Server URL**: The full URL to your Open Edison MCP endpoint (`http://localhost:3000/mcp/`)
- **API Key**: Your authentication key for the Open Edison server (configured in `config.json`; local default `dev-api-key-change-me`)

### Open Edison Server Setup

Make sure your Open Edison server is running and accessible:

1. **Start Open Edison**: `make run` in your Open Edison directory
2. **Configure MCP servers**: Edit `config.json` to add your MCP servers
3. **Set API key**: Ensure `server.api_key` is set in your `config.json`

Your server should be accessible at `http://localhost:3000`.

## How It Works

This extension uses [mcp-remote](https://www.npmjs.com/package/mcp-remote) under the hood to:

1. **Establish Connection**: Connect to your Open Edison server over HTTP
2. **Handle Authentication**: Automatically include your API key in requests
3. **Proxy MCP Protocol**: Translate between local stdio and remote HTTP protocols
4. **Manage Sessions**: Handle connection lifecycle and error recovery

The connection flow:

```
Claude Desktop ↔ Extension (mcp-remote) ↔ Open Edison Server ↔ Your Configured MCP Servers
```

## Security & Privacy

This extension operates securely:

- ✅ **Secure Credential Storage**: API keys stored in OS keychain
- ✅ **Direct Server Connection**: No third-party proxies
- ✅ **Configurable Endpoints**: Connect to your own infrastructure
- ✅ **HTTP/HTTPS Support**: Supports both local and encrypted connections
- ❌ **No File System Access**: Cannot read or write local files
- ❌ **No System Execution**: Cannot execute system commands

## Troubleshooting

### Common Issues

**1. "Connection failed" errors**

- Verify your server URL is correct and reachable
- Check that your Open Edison server is running (`make run`)
- Ensure your API key is valid

**2. "Authentication failed"**

- Double-check your API key matches the one in Open Edison's `config.json`
- Verify the API key format is correct
- Try restarting your Open Edison server

**3. "No tools available"**

- Ensure you have MCP servers configured in your Open Edison `config.json`
- Check your Open Edison server logs for any errors
- Start MCP servers using the extension tools or Open Edison API

**4. "Extension won't install"**

- Ensure you have Claude Desktop version that supports extensions
- Check that the `.dxt` file is not corrupted by re-downloading it
- Try restarting Claude Desktop

### Debug Steps

1. **Check server accessibility**: Try accessing `http://localhost:3001/health` (management API) in a browser
2. **Verify API key**: Check the `server.api_key` value in your Open Edison `config.json`
3. **Check logs**: Look at Claude Desktop logs for connection errors
4. **Test MCP endpoint**: Use curl to test the `/mcp/` endpoint

### Log Locations

- **macOS**: `~/Library/Logs/Claude/mcp*.log`
- **Windows**: `%APPDATA%\Claude\Logs\mcp*.log`

## Development

### Building from Source

1. **Clone the repository**:

   ```bash
   git clone https://github.com/Edison-Watch/open-edison
   cd open-edison/desktop_ext
   ```

2. **Install DXT CLI**:

   ```bash
   npm install -g @anthropic-ai/dxt
   ```

3. **Package the extension**:

   ```bash
   dxt pack
   ```

4. **Install in Claude Desktop**:
   Drag the generated `open-edison-connector.dxt` file into Claude Desktop Settings → Extensions.

### Project Structure

```
desktop_ext/
├── manifest.json          # Extension configuration
├── README.md              # This documentation
├── INSTALLATION.md        # Installation guide
├── package.json           # Build scripts
├── icon.svg              # Extension icon
├── build.sh              # Build automation
└── test_connection.js    # Connection testing
```

## Contributing

This extension is part of the Open Edison project. See the main repository for contribution guidelines:
<https://github.com/Edison-Watch/open-edison>

## Related Resources

- [Open Edison Main Repository](https://github.com/Edison-Watch/open-edison)
- [mcp-remote Package](https://www.npmjs.com/package/mcp-remote)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic Desktop Extensions](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

## License

GPL-3.0 License - same as the main Open Edison project.
