#!/bin/sh
set -e

echo "=== Gemini CLI test session ==="

if [ -z "$GEMINI_API_KEY" ]; then
  echo "GEMINI_API_KEY not set. Skipping real API call."
  echo "Set it in .env to run real conversations."
  # Keep container alive so volumes are visible
  sleep infinity
fi

# Run gemini with non-interactive prompts
# Gemini CLI uses --prompt for non-interactive mode
echo "Running Gemini CLI prompts..."

gemini -p "Look at the files in this directory and explain what the project does. Be concise." 2>&1 || true

sleep 2

gemini -p "Add a simple unit test for the add function in math.ts. Write it to test/math.test.ts" 2>&1 || true

sleep 2

gemini -p "What improvements would you suggest for this codebase? List 3 specific suggestions." 2>&1 || true

echo ""
echo "=== Gemini CLI sessions written to ~/.gemini ==="
ls -la ~/.gemini/ 2>/dev/null || echo "(no data yet)"
ls -la ~/.gemini/tmp/ 2>/dev/null || echo "(no tmp data)"

# Keep alive so jin can read
echo "Keeping container alive for jin to read data..."
sleep infinity
