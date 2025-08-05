#!/bin/bash
# Build script for Open Edison Connector Desktop Extension

set -e

echo "🚀 Building Open Edison Connector Desktop Extension..."

# Check if we're in the right directory
if [ ! -f "manifest.json" ]; then
    echo "❌ Error: manifest.json not found. Please run from desktop_ext directory."
    exit 1
fi

# Check if Node.js is available  
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is required but not installed."
    exit 1
fi

# Check if npx is available (for mcp-remote)
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx is required but not installed."
    exit 1
fi

echo "✅ Node.js and npx are available"

# Validate the manifest and test connection
echo "🧪 Testing configuration..."
node test_connection.js

# Validate the manifest (if dxt CLI is available)
if command -v dxt &> /dev/null; then
    echo "✅ Validating manifest.json..."
    dxt validate manifest.json
    
    echo "📦 Packaging extension..."
    dxt pack
    
    echo "✅ Extension packaged successfully!"
    echo "📋 Output: open-edison-connector.dxt"
else
    echo "⚠️  DXT CLI not found. Install with: npm install -g @anthropic-ai/dxt"
    echo "📦 Manual packaging required."
fi

echo ""
echo "🎉 Build process completed!"
echo ""
echo "📋 Next steps:"
echo "   1. If dxt CLI is installed, the .dxt file is ready"
echo "   2. If not, install dxt CLI: npm install -g @anthropic-ai/dxt"
echo "   3. Run 'dxt pack' to create the .dxt file"
echo "   4. Install in Claude Desktop by dragging the .dxt file to Settings → Extensions"
echo "   5. Configure with your Open Edison server URL and API key"