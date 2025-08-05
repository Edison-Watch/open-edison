#!/usr/bin/env node

/**
 * Test script for Open Edison Connector Desktop Extension
 * 
 * This script validates the configuration and tests connectivity
 * to Open Edison servers without requiring the full DXT setup.
 */

const https = require('https');
const http = require('http');
const url = require('url');

// Test configuration examples
const TEST_CONFIGS = [
    {
        name: "Local Development",
        server_url: "http://localhost:3001/mcp/call",
        api_key: "your-secure-api-key"
    },
    {
        name: "Remote Server",
        server_url: "https://your-server.com:3001/mcp/call",
        api_key: "your-secure-api-key"
    }
];

function testConnection(config) {
    return new Promise((resolve, reject) => {
        console.log(`\n🧪 Testing connection to ${config.name}`);
        console.log(`📍 URL: ${config.server_url}`);
        console.log(`🔑 API Key: ${config.api_key.substring(0, 8)}...`);

        const parsedUrl = url.parse(config.server_url);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        // Test with a simple MCP initialization request
        const testRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "open-edison-connector-test",
                    version: "1.0.0"
                }
            }
        };

        const postData = JSON.stringify(testRequest);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.api_key}`,
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
                'User-Agent': 'Open-Edison-Connector-Test/1.0.0'
            },
            timeout: 5000
        };

        const req = client.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`✅ Connection successful (Status: ${res.statusCode})`);
                    try {
                        const response = JSON.parse(data);
                        console.log(`📊 MCP Response: ${response.result ? 'Valid MCP response' : 'Unexpected response format'}`);
                    } catch (e) {
                        console.log(`📊 Response length: ${data.length} bytes (not JSON)`);
                    }
                    resolve({ success: true, status: res.statusCode, data });
                } else {
                    console.log(`⚠️  Unexpected status: ${res.statusCode}`);
                    console.log(`📄 Response: ${data.substring(0, 200)}...`);
                    resolve({ success: false, status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err) => {
            console.log(`❌ Connection failed: ${err.message}`);
            reject(err);
        });

        req.on('timeout', () => {
            console.log(`⏰ Connection timeout`);
            req.destroy();
            reject(new Error('Connection timeout'));
        });

        req.write(postData);
        req.end();
    });
}

function validateManifest() {
    console.log('📋 Validating manifest.json...');

    try {
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

        // Validate required fields
        const required = ['dxt_version', 'name', 'version', 'server', 'user_config'];
        const missing = required.filter(field => !manifest[field]);

        if (missing.length > 0) {
            console.log(`❌ Missing required fields: ${missing.join(', ')}`);
            return false;
        }

        // Validate user config
        const userConfig = manifest.user_config;
        if (!userConfig.server_url || !userConfig.api_key) {
            console.log('❌ Missing required user_config fields: server_url, api_key');
            return false;
        }

        // Validate server config
        const server = manifest.server;
        if (server.type !== 'node') {
            console.log('❌ Server type should be "node" for mcp-remote');
            return false;
        }

        const args = server.mcp_config.args;
        if (!args.includes('mcp-remote')) {
            console.log('❌ Server args should include "mcp-remote"');
            return false;
        }

        console.log('✅ Manifest validation passed');
        console.log(`📦 Extension: ${manifest.display_name} v${manifest.version}`);
        console.log(`🔗 Type: ${server.type} (mcp-remote wrapper)`);

        return true;

    } catch (err) {
        console.log(`❌ Manifest validation failed: ${err.message}`);
        return false;
    }
}

function generateExampleCommand(config) {
    console.log(`\n📝 Example mcp-remote command for ${config.name}:`);
    console.log(`npx -y mcp-remote "${config.server_url}" --header "Authorization:Bearer ${config.api_key}" --transport http-only --allow-http`);
}

async function main() {
    console.log('🚀 Open Edison Connector - Connection Test');
    console.log('='.repeat(50));

    // Validate manifest
    if (!validateManifest()) {
        process.exit(1);
    }

    // Test connections
    console.log('\n🌐 Testing server connections...');
    console.log('⚠️  Note: Connections will fail unless your Open Edison server is running');

    for (const config of TEST_CONFIGS) {
        try {
            await testConnection(config);
            generateExampleCommand(config);
        } catch (err) {
            console.log(`💥 Test failed for ${config.name}: ${err.message}`);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Connection tests completed!');
    console.log('\n📋 Next steps:');
    console.log('   1. Start your Open Edison server: make run');
    console.log('   2. Install DXT CLI: npm install -g @anthropic-ai/dxt');
    console.log('   3. Package extension: dxt pack');
    console.log('   4. Install in Claude Desktop');
    console.log('   5. Configure with your server URL and API key');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testConnection, validateManifest };