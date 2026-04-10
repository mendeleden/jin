# Clean-Start Postgres Push Regression

## Scope

- validation date: `2026-04-08`
- surface:
  - rebuilt current local binary
  - removed `~/.config/jin`
  - reprovisioned sinks and routes from scratch
  - ran clean local ingest and checked push state
- destinations:
  - local Docker Postgres
  - Railway Postgres

## Exact Setup

### Config backup and clean reset

- saved prior config only to:
  - `/tmp/jin-config-backup.raSdNE/config.json`
- removed:
  - `~/.config/jin`

### Schema and sink bootstrap

- local Postgres:
  - `jin team schema apply --connection-string="$JIN_LOCAL_PG"`
  - `jin sink add postgres --connection-string="$JIN_LOCAL_PG" --id=team-local-postgres`
- Railway Postgres:
  - `jin team schema apply --connection-string="$JIN_RAILWAY_PG"`
  - `jin sink add postgres --connection-string="$JIN_RAILWAY_PG" --id=team-railway-postgres`
- routes:
  - `jin route add --remote=github.com/mendeleden/jin --sink=team-local-postgres`
  - `jin route add --remote=github.com/mendeleden/jin --sink=team-railway-postgres`

### Clean ingest

- command:
  - `jin ingest`

## Observed Local Store Result

- conversations: `1085`
- messages: `56176`
- tool calls: `30644`

This proves clean-store discover/load/write still runs far enough to populate
SQLite from scratch.

## Observed Sink Result

### Local Docker Postgres

- `jin_conversations`: `0`
- `jin_messages`: `0`

### Railway Postgres

- `jin_conversations`: `0`
- `jin_messages`: `0`

## Push-State Evidence

Representative local `_jin_push_state.last_error` rows:

- sink: `team-local-postgres`
- error: `Only use sql.begin, sql.reserved or max: 1`

The same failure class blocked the fresh-start push path after local ingest had
already succeeded.

## Adjacent Failure Exposed By The Clean Store

During the same clean ingest, Claude Code surfaced a separate write failure:

- repeated `UNIQUE constraint failed: messages.id`

That is a real regression, but it is **not** the same bug as the Postgres push
failure. The store already contained thousands of rows before the sink-side
error was inspected.

## Interpretation

The clean-start path isolates the current regression clearly:

- provisioning works
- local store ingest works
- Postgres sink delivery does not

This is a sink-side blocker, not a bootstrap or route-creation problem.

It also shows why sink validation must be a separate release lane. A candidate
can look healthy from CLI bootstrap and local-ingest signals while still
delivering zero rows to every configured destination.

## Open Question

The current failure does not yet prove that outbound identity fields such as
`userId` are required for delivery.

Treat this as a separate contract/product question unless the sink fix shows
that missing identity metadata is the concrete cause of push rejection.

## Follow-Up

- `W3-SINK-04` owns:
  - the Postgres push regression
  - repeatable local-and-remote sink validation from a fresh-start config
