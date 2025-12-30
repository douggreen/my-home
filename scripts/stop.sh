#!/bin/bash
# Stop the Photo Classification Web UI
# Run from project root: ./scripts/stop.sh

PID=$(lsof -ti:5001)
if [ -n "$PID" ]; then
    echo "Stopping server (PID: $PID)..."
    kill $PID
else
    echo "Server not running"
fi
