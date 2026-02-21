#!/bin/sh
set -e

echo "=== Codex CLI test session ==="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "OPENAI_API_KEY not set. Skipping real API call."
  echo "Set it in .env to run real conversations."
  sleep infinity
fi

echo "Running Codex prompts..."

# Codex uses --quiet and prompt as positional arg
codex "Look at the files in this workspace and explain the project structure" 2>&1 || true

sleep 2

codex "Write a simple HTTP server in server.ts that serves the math functions as a REST API" 2>&1 || true

sleep 2

codex "Review the code you just wrote and suggest any security improvements" 2>&1 || true

echo ""
echo "=== Codex sessions written to ~/.codex ==="
ls -laR ~/.codex/ 2>/dev/null || echo "(no data yet)"

echo "Keeping container alive for jin to read data..."
sleep infinity
