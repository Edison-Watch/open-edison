#!/bin/bash

# Script to start Open Edison backend manually
# This can be useful if the desktop app can't start it automatically

echo "🚀 Starting Open Edison Backend Server..."

# Check if we're in the right directory
if [ ! -f "../main.py" ]; then
    echo "❌ Error: Please run this script from the gui directory"
    exit 1
fi

# Get the project root (parent directory)
PROJECT_ROOT=$(dirname "$(dirname "$(realpath "$0")")")
cd "$PROJECT_ROOT"

echo "📁 Project root: $PROJECT_ROOT"

# Try different methods to start the backend
echo "🔍 Trying to start Open Edison backend..."

# Method 1: Try uvx open-edison (recommended for uv users)
if command -v uvx &> /dev/null; then
    echo "✅ Found uvx, trying uvx open-edison..."
    uvx open-edison
    exit 0
fi

# Method 2: Try open-edison command
if command -v open-edison &> /dev/null; then
    echo "✅ Found open-edison command, starting..."
    open-edison
    exit 0
fi

# Method 3: Try python -m src.cli
echo "🐍 Trying python -m src.cli..."
python -m src.cli

# Method 4: Try python3 -m src.cli
if [ $? -ne 0 ]; then
    echo "🐍 Trying python3 -m src.cli..."
    python3 -m src.cli
fi

# Method 5: Try direct python execution
if [ $? -ne 0 ]; then
    echo "🐍 Trying python main.py..."
    python main.py
fi

# Method 6: Try python3 direct execution
if [ $? -ne 0 ]; then
    echo "🐍 Trying python3 main.py..."
    python3 main.py
fi

echo "✅ Backend startup attempted. Check the output above for any errors."
