#!/bin/bash

# Script to restart the frontend dev server with new proxy configuration
echo "🔄 Restarting frontend dev server with proxy configuration..."

# Kill any existing frontend dev server
pkill -f "vite.*dev" || true

# Wait a moment
sleep 2

# Start the frontend dev server
echo "🚀 Starting frontend dev server..."
cd ../frontend && npm run dev &

# Wait for it to start
sleep 5

echo "✅ Frontend dev server restarted with proxy configuration"
echo "   API requests will now be proxied to http://localhost:3000"
