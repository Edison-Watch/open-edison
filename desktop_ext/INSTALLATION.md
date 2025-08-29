# Open Edison Connector - Installation Guide

## Quick Installation (For Users)

1. **Download** the pre-built `open-edison-connector.dxt` file
2. **Open Claude Desktop** application
3. **Go to Settings** → Extensions
4. **Click "Install Extension"** or drag the `.dxt` file into the window
5. **Configure your connection**:
   - **Server URL**: Your Open Edison server MCP API endpoint
   - **API Key**: Your Open Edison API key
6. **Click "Install"** when prompted
7. **Done!** Your Open Edison server is now connected

## Configuration Details

### Server URL

Enter the full URL to your Open Edison MCP endpoint:

**Local Development:**

```
http://localhost:3000/mcp/
```

<!-- Remote/Docker scenarios intentionally omitted: localhost-only setup -->

### API Key

Enter your Open Edison API key as configured in your `config.json` file under `server.api_key`. This is the key you set when configuring Open Edison.

## Building from Source (For Developers)

### Prerequisites

- Node.js (for DXT CLI tools)
- Open Edison server running and accessible

### Step 1: Install DXT CLI

```bash
npm install -g @anthropic-ai/dxt
```

### Step 2: Clone and Navigate

```bash
git clone https://github.com/Edison-Watch/open-edison
cd open-edison/desktop_ext
```

### Step 3: Package the Extension

```bash
dxt pack
```

This creates `open-edison-connector.dxt`

### Step 4: Install in Claude Desktop

Drag the generated `.dxt` file into Claude Desktop Settings → Extensions.

## What This Extension Provides

### Automatic Access To

- All your configured MCP servers in Open Edison
- Server management and lifecycle tools
- Server health and status information
- Custom tools you've configured

### Connection Management

- Secure API key storage in OS keychain
- Automatic reconnection handling
- Error recovery and retry logic
- Session persistence

## Security Features

- **Secure Storage**: API keys never stored in plain text
- **Direct Connection**: No third-party intermediaries
- **Configurable Endpoints**: Connect only to your servers
- **Minimal Permissions**: No file system or system access

## Troubleshooting

### Extension Installation Issues

**"Extension won't install"**

- Update to latest Claude Desktop version
- Verify `.dxt` file integrity by re-downloading
- Restart Claude Desktop and try again

### Connection Issues

**"Cannot connect to server"**

1. Verify server URL format includes `/mcp/` endpoint
2. Test server accessibility: `curl http://localhost:3000/health`
3. Check firewall/network restrictions
4. Ensure Open Edison server is running: `make run`

**"Authentication failed"**

1. Verify API key matches the one in Open Edison `config.json`
2. Check API key format is correct
3. Try restarting Open Edison server

**"No tools available"**

1. Ensure MCP servers are configured in Open Edison `config.json`
2. Start MCP servers using Open Edison API or extension tools
3. Review Open Edison server logs

### Configuration Examples

**Typical Local Setup:**

```
Server URL: http://localhost:3000/mcp/
API Key: dev-api-key-change-me
```

**Production Setup:**

```
Server URL: https://edison.company.com:3000/mcp/call
API Key: prod-api-key-123
```

### Testing Your Setup

After installation, you should see:

1. Extension listed in Claude Desktop Settings → Extensions
2. New tools available in Claude chat (hammer icon)
3. Access to your Open Edison server's configured MCP tools

### Debug Information

**Log Locations:**

- macOS: `~/Library/Logs/Claude/mcp*.log`
- Windows: `%APPDATA%\Claude\Logs\mcp*.log`

**Common Log Messages:**

- `Connected to Open Edison server` - Success
- `Authentication failed` - Check API key
- `Connection timeout` - Check server URL/network

**Testing Endpoints:**

Test your Open Edison server manually:

```bash
# Health check (management API)
curl http://localhost:3001/health

# MCP status (requires API key; management API)
curl -H "Authorization: Bearer dev-api-key-change-me" http://localhost:3001/mcp/status

# Test MCP call (requires API key; MCP endpoint)
curl -X POST \
  -H "Authorization: Bearer dev-api-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' \
  http://localhost:3000/mcp/
```

## Support

### For Extension Issues

- Check the [Open Edison repository](https://github.com/Edison-Watch/open-edison)
- Create an issue with logs and configuration details

### For General Desktop Extension Support

- Refer to [Anthropic's Desktop Extension documentation](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- Check Claude Desktop version compatibility

### For Open Edison Server Issues

- See the main Open Edison documentation
- Check server logs and configuration
- Verify MCP server configuration in `config.json`
- Ensure proper API key setup
