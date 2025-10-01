#!/bin/bash

# Open Edison Desktop Launcher
# This script ensures all dependencies are installed and launches the desktop app

set -e

echo "🚀 Starting Open Edison Desktop Application..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the gui directory"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if Open Edison is installed
if ! command -v open-edison &> /dev/null; then
    echo "⚠️  Warning: Open Edison backend not found in PATH"
    echo "   Make sure Open Edison is installed: pip install open-edison"
    echo "   The app will try to start it anyway..."
fi

# Check if frontend dependencies are installed
if [ ! -d "../frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd ../frontend
    npm install
    cd ../gui
fi

# Set development mode
export NODE_ENV=development

echo "🎯 Launching Open Edison Desktop in development mode..."
npm run electron:dev
