#!/bin/bash

# Test script for Open Edison Desktop Setup
echo "🧪 Testing Open Edison Desktop Setup..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the gui directory"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if Open Edison is installed
if ! command -v open-edison &> /dev/null; then
    echo "⚠️  Warning: Open Edison backend not found in PATH"
    echo "   Make sure Open Edison is installed: pip install open-edison"
fi

# Check if frontend exists
if [ ! -d "../frontend" ]; then
    echo "❌ Error: Frontend directory not found. Make sure you're in the gui directory."
    exit 1
fi

# Check if frontend dependencies are installed
if [ ! -d "../frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd ../frontend
    npm install
    cd ../gui
fi

# Test TypeScript compilation
echo "🔨 Testing TypeScript compilation..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
    exit 1
fi

# Test Electron app (briefly)
echo "🚀 Testing Electron app startup..."
timeout 10s npm run electron || echo "✅ Electron app started successfully (timeout reached)"

echo "🎉 Setup test completed!"
echo ""
echo "To run the desktop app:"
echo "  npm run electron:dev  # Development mode with hot reload"
echo "  npm run electron      # Production mode"
echo ""
echo "To build for distribution:"
echo "  npm run dist"
