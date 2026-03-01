#!/usr/bin/env bash
set -e

##
## jin local deployment setup
##
## Generates the team config and starts jin + Postgres in Docker.
##
## Usage:
##   ./setup.sh                     # Use defaults
##   ./setup.sh --team-id=myteam    # Custom team ID
##

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TEAM_ID="local"
POSTGRES_USER="jin"
POSTGRES_PASSWORD="jin"
POSTGRES_DB="jin"

# Parse args
for arg in "$@"; do
  case $arg in
    --team-id=*) TEAM_ID="${arg#*=}" ;;
    --pg-user=*) POSTGRES_USER="${arg#*=}" ;;
    --pg-pass=*) POSTGRES_PASSWORD="${arg#*=}" ;;
  esac
done

CONNECTION_STRING="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"

# Generate team config (base64-encoded sink config)
TEAM_CONFIG=$(echo -n "{\"type\":\"postgres\",\"connectionString\":\"${CONNECTION_STRING}\",\"teamId\":\"${TEAM_ID}\",\"schema\":\"public\"}" | base64 -w0 2>/dev/null || echo -n "{\"type\":\"postgres\",\"connectionString\":\"${CONNECTION_STRING}\",\"teamId\":\"${TEAM_ID}\",\"schema\":\"public\"}" | base64)

# Write .env
cat > .env <<EOF
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_PORT=5433
JIN_TEAM_CONFIG=${TEAM_CONFIG}
EOF

echo "  Generated .env with team-id=${TEAM_ID}"
echo ""
echo "  Starting jin + Postgres..."
echo ""

docker compose up -d

echo ""
echo "  Done. jin is watching your coding tool conversations."
echo ""
echo "  View sessions:  docker compose run --rm jin sessions"
echo "  Analyze costs:  docker compose run --rm jin stats"
echo "  Query Postgres: docker compose exec postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}"
echo "  View logs:      docker compose logs -f jin"
echo "  Stop:           docker compose down"
echo ""
