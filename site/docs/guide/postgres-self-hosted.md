# Self-Hosted PostgreSQL

Run your own Postgres instance and have all team members push session data to it. Full control, data stays on your infra.

## Option A: Docker (quickest)

### 1. Start Postgres

```sh
docker run -d \
  --name jin-postgres \
  -e POSTGRES_USER=jin \
  -e POSTGRES_PASSWORD=changeme \
  -e POSTGRES_DB=jin \
  -p 5432:5432 \
  --restart unless-stopped \
  postgres:16-alpine
```

### 2. Generate the team config

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://jin:changeme@your-server:5432/jin" \
  --team-id=my-team
```

Replace `your-server` with the hostname/IP reachable by your developers (internal DNS, VPN, tailscale, etc).

### 3. Distribute to developers

Each developer runs:

```sh
jin init --team=<the-code-from-step-2>
jin watch --daemon
```

## Option B: Docker Compose

For a more complete setup with persistence and optional Metabase for dashboards.

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: jin
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: jin
    volumes:
      - jin-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  # Optional: add Metabase for dashboards
  metabase:
    image: metabase/metabase:latest
    ports:
      - "3000:3000"
    environment:
      MB_DB_TYPE: postgres
      MB_DB_DBNAME: jin
      MB_DB_PORT: 5432
      MB_DB_USER: jin
      MB_DB_PASS: changeme
      MB_DB_HOST: postgres
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  jin-data:
```

```sh
docker compose up -d
```

- Postgres at `localhost:5432`
- Metabase dashboard at `localhost:3000`

## Option C: Existing Postgres

If you already have a Postgres instance (RDS, Cloud SQL, Neon, Supabase, etc):

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://user:pass@your-host:5432/your-db?sslmode=require" \
  --team-id=my-team
```

jin creates its tables automatically on first push. No manual schema setup needed.

## Schema

jin creates these tables in the target database:

| Table | Contents |
|-------|----------|
| `sessions` | One row per conversation session |
| `messages` | Individual messages with tokens, model, tool calls |
| `push_log` | Delivery tracking (deduplication) |

## Useful queries

### Sessions per developer, last 7 days

```sql
SELECT
  metadata->>'developerId' AS developer,
  adapter_id AS tool,
  COUNT(*) AS sessions,
  SUM(total_tokens) AS tokens,
  ROUND(SUM(est_cost)::numeric, 2) AS cost
FROM sessions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY cost DESC;
```

### Most expensive sessions

```sql
SELECT
  id,
  adapter_name AS tool,
  name,
  total_tokens,
  ROUND(est_cost::numeric, 2) AS cost,
  created_at
FROM sessions
ORDER BY est_cost DESC
LIMIT 20;
```

### Token usage by model

```sql
SELECT
  model,
  COUNT(*) AS messages,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens
FROM messages
WHERE model != ''
GROUP BY model
ORDER BY input_tokens + output_tokens DESC;
```

## Security notes

- The connection string is base64-encoded in the team config code — it is **not encrypted**. Treat it like a password.
- Use a dedicated Postgres user with limited permissions for jin (INSERT on sessions/messages/push_log).
- If exposing Postgres over the internet, always use `sslmode=require`.
- Consider running behind a VPN or Tailscale for internal team access.
