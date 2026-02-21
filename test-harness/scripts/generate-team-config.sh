#!/bin/sh
# Generate the JIN_TEAM_CONFIG for the local Postgres container.
# Run this, then paste the output into your .env file.

echo "Generating team config for local Postgres..."

CONFIG='{"type":"postgres","connectionString":"postgres://jin:jin@postgres:5432/jin","teamId":"test-team","schema":"public"}'
ENCODED=$(echo -n "$CONFIG" | base64 -w 0)

echo ""
echo "Add this to your .env:"
echo ""
echo "JIN_TEAM_CONFIG=$ENCODED"
echo ""
echo "Or run jin directly:"
echo ""
echo "  jin init --team=$ENCODED"
