#!/bin/sh
set -e

echo "=== OpenCode test session ==="

# Check for any provider key
HAS_KEY=""
[ -n "$ANTHROPIC_API_KEY" ] && HAS_KEY="anthropic"
[ -n "$OPENAI_API_KEY" ] && HAS_KEY="openai"
[ -n "$GEMINI_API_KEY" ] && HAS_KEY="gemini"

if [ -z "$HAS_KEY" ]; then
  echo "No API keys set (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)."
  echo "Set one in .env to run real conversations."
  sleep infinity
fi

echo "Using provider: $HAS_KEY"
echo "Running OpenCode prompts..."

# OpenCode may use different invocation depending on version
OPENCODE_CMD="opencode"
command -v opencode >/dev/null 2>&1 || OPENCODE_CMD="npx opencode-ai"

$OPENCODE_CMD "Analyze the project files and explain what this codebase does" 2>&1 || true

sleep 2

$OPENCODE_CMD "Add error handling to the math functions — throw on division by zero" 2>&1 || true

echo ""
echo "=== OpenCode sessions ==="
ls -laR ~/.local/share/opencode/ 2>/dev/null || echo "(no data yet)"

echo "Keeping container alive for jin to read data..."
sleep infinity
