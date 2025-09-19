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

echo "✅ Using npx for DXT packaging..."

echo "✅ Validating manifest.json..."
npx -y @anthropic-ai/dxt validate manifest.json

echo "📦 Packaging extension..."
npx -y @anthropic-ai/dxt pack

# Ensure canonical output filename exists deterministically
CANONICAL="open-edison-connector.dxt"
DEFAULT_OUT="desktop_ext.dxt"
if [ -f "$DEFAULT_OUT" ]; then
    cp "$DEFAULT_OUT" "$CANONICAL"
    echo "🪄 Copied $DEFAULT_OUT -> $CANONICAL"
elif [ -f "$CANONICAL" ]; then
    echo "✅ Canonical DXT present: $CANONICAL"
else
    echo "❌ Packaging did not produce expected $DEFAULT_OUT"
    exit 1
fi

echo "✅ Extension packaged successfully!"
echo "📋 Output: $CANONICAL"

echo ""
echo "🎉 Build process completed!"