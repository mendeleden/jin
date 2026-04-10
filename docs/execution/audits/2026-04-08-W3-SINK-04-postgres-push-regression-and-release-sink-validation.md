# W3-SINK-04 Postgres Push Regression And Release Sink Validation

## Scope

- validation date: `2026-04-08`
- packet: `W3-SINK-04`
- owned surfaces:
  - `src/sinks/postgres.ts`
  - `test/postgres-reference-sink.test.ts`
  - this audit artifact
- target regression:
  - `_jin_push_state.last_error = "Only use sql.begin, sql.reserved or max: 1"`

## Exact RCA

`PostgresSink.checkSchemaCompatibility()` used `query()`.
For `postgres://` / `postgresql://` sinks, `query()` routed to `queryPsql()`, which
previously executed `this.getConn().unsafe(...)` on the root Bun SQL client.

On the Bun SQL client/pool, root `unsafe` calls can be rejected with:

- `Only use sql.begin, sql.reserved or max: 1`

That failure happened before any row-level DML, so push returned per-conversation
failures and both local/remote Postgres tables stayed at `0` rows.

## Code Changes

- `src/sinks/postgres.ts`
  - changed `queryPsql()` to execute through `sql.begin(...)` and run SQL via
    the transaction executor, eliminating root-client `unsafe` usage on the
    Postgres transport path.
- `test/postgres-reference-sink.test.ts`
  - replaced/expanded the postgres transport regression test so root-client
    `unsafe` throws `Only use sql.begin, sql.reserved or max: 1`.
  - test now proves schema check + DML run inside `sql.begin(...)` and push
    succeeds.

## Focused Regression Coverage

Command:

```sh
bun test test/postgres-reference-sink.test.ts
```

Observed:

- `6` passed
- `0` failed
- includes regression test:
  - `push uses sql.begin for postgres:// schema and DML queries when root-client unsafe is disallowed`

## Clean-Start Local + Remote Validation Path

The release-path command sequence (disposable config) is:

```sh
# 1) disposable config root
RUN_ROOT="/tmp/jin-w3-sink-04-$(date +%s)"
export JIN_CONFIG_DIR="$RUN_ROOT/config"
mkdir -p "$JIN_CONFIG_DIR"

# 2) source sink connection strings from an existing trusted config snapshot
BASE_CFG="$HOME/.config/jin/config.json"
LOCAL_PG=$(jq -r '.sinks[] | select(.id=="team-local-postgres") | .connectionString' "$BASE_CFG")
RAILWAY_PG=$(jq -r '.sinks[] | select(.id=="team-railway-postgres") | .connectionString' "$BASE_CFG")

# 3) clean bootstrap
bun src/index.ts team schema apply --connection-string="$LOCAL_PG"
bun src/index.ts team schema apply --connection-string="$RAILWAY_PG"
bun src/index.ts sink add postgres --connection-string="$LOCAL_PG" --id=team-local-postgres
bun src/index.ts sink add postgres --connection-string="$RAILWAY_PG" --id=team-railway-postgres
bun src/index.ts route add --remote=github.com/mendeleden/jin --sink=team-local-postgres
bun src/index.ts route add --remote=github.com/mendeleden/jin --sink=team-railway-postgres

# 4) clean ingest + push
bun src/index.ts ingest

# 5) row-count checks
sqlite3 "$JIN_CONFIG_DIR/store.db" "
  select count(*) as conversations from conversations;
  select count(*) as messages from messages;
  select count(*) as tool_calls from tool_calls;
"

psql "$LOCAL_PG" -Atqc "select count(*) from public.jin_conversations"
psql "$LOCAL_PG" -Atqc "select count(*) from public.jin_messages"
psql "$RAILWAY_PG" -Atqc "select count(*) from public.jin_conversations"
psql "$RAILWAY_PG" -Atqc "select count(*) from public.jin_messages"

sqlite3 "$JIN_CONFIG_DIR/store.db" "
  select sink_id,
         count(*) as rows,
         sum(case when last_successful_revision > 0 then 1 else 0 end) as successful,
         sum(case when last_error <> '' then 1 else 0 end) as errored
  from _jin_push_state
  group by sink_id
  order by sink_id;
"
```

## Sandbox Validation Result In This Worker Session

Attempted connectivity checks in this Codex sandbox:

```sh
LOCAL_PG=$(jq -r '.sinks[] | select(.id=="team-local-postgres") | .connectionString' ~/.config/jin/config.json)
psql "$LOCAL_PG" -Atqc "select 'ok', count(*) from public.jin_meta"
```

Observed:

- `connection to server at "localhost" ... failed: Operation not permitted`

```sh
RAILWAY_PG=$(jq -r '.sinks[] | select(.id=="team-railway-postgres") | .connectionString' ~/.config/jin/config.json)
psql "$RAILWAY_PG" -Atqc "select 'ok', count(*) from public.jin_meta"
```

Observed:

- `could not translate host name ... nodename nor servname provided, or not known`

Because this sandbox disallows the required TCP/DNS path, local+remote row
counts could not be collected here.

## Row Count Outcome (This Session)

- local SQLite store counts: `not collected in clean-start run (network-blocked session)`
- local Docker Postgres counts: `unavailable (sandbox TCP denied)`
- Railway Postgres counts: `unavailable (sandbox DNS/network denied)`
- `_jin_push_state` success rows from a clean-start run: `unavailable in this sandbox`

## Identity Note

`userId` / developer identity fields were **not required** for this fix.
The regression was transport-level transaction usage in the Postgres sink.
Identity outbound semantics remain a separate contract/product question.
