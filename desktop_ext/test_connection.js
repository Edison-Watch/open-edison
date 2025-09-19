#!/usr/bin/env node

/**
 * Test script for Open Edison Connector Desktop Extension
 * 
 * This script validates the configuration and tests connectivity
 * to Open Edison servers without requiring the full DXT setup.
 */

const https = require('https');
const http = require('http');

// Test configuration examples
const TEST_CONFIGS = [
    {
        name: "Local Development",
        server_url: "http://localhost:3000/mcp/",
        api_key: "your-secure-api-key"
    },
    // Localhost-only setup; remote examples removed by design
];

function testConnection(config) {
    return new Promise((resolve, reject) => {
        console.log(`\n🧪 Testing connection to ${config.name}`);
        console.log(`📍 URL: ${config.server_url}`);
        console.log(`🔑 API Key: ${config.api_key.substring(0, 8)}...`);

        let parsedUrl;
        try {
            parsedUrl = new URL(config.server_url);
        } catch (e) {
            console.log(`❌ Invalid URL: ${e.message}`);
            return resolve({ success: false, error: e });
        }
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
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.api_key}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(postData),
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
                    return resolve({ success: true, status: res.statusCode, data });
                }

                // Friendlier messaging for common cases
                if (res.statusCode === 401) {
                    console.log('🔒 Authentication failed (401). Check your API key in Open Edison `config.json` and extension settings.');
                } else if (res.statusCode === 404) {
                    console.log('🔎 Endpoint not found (404). Ensure the path is `/mcp/`.');
                } else {
                    console.log(`⚠️  HTTP ${res.statusCode}. Partial response: ${data.substring(0, 200)}...`);
                }
                resolve({ success: false, status: res.statusCode, data });
            });
        });

        req.on('error', (err) => {
            if (err && err.code === 'ECONNREFUSED') {
                console.log('ℹ️  Open Edison is not running at http://localhost:3000. This is expected during packaging. Run `make run` to start it.');
            } else {
                console.log(`❌ Connection error: ${err.code || ''} ${err.message}`.trim());
            }
            // Do not fail the build; resolve with a non-success result
            resolve({ success: false, error: err });
        });

        req.on('timeout', () => {
            console.log(`⏰ Connection timeout`);
            req.destroy();
            resolve({ success: false, error: new Error('Connection timeout') });
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
    console.log(`npx -y mcp-remote "${config.server_url}" --header "Authorization: Bearer ${config.api_key}" --header "Accept: application/json, text/event-stream" --transport http-only --allow-http`);
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
        const result = await testConnection(config);
        generateExampleCommand(config);
        if (!result.success) {
            console.log('📝 Skipping live MCP verification until the server is running.');
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Connection tests completed!');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testConnection, validateManifest };