#!/bin/bash
# Start the Photo Classification Web UI
# Run from project root: ./scripts/start.sh

# Stop any existing server
PID=$(lsof -ti:5001)
if [ -n "$PID" ]; then
    echo "Stopping existing server (PID: $PID)..."
    kill $PID
    sleep 1
fi

# Activate virtual environment if it exists
if [ -f venv/bin/activate ]; then
    source venv/bin/activate
fi

# Start Flask server
echo "Starting Photo Classification Web UI..."
echo "Open http://localhost:5001 in your browser"
python web/app.py
