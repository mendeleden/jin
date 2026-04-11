# W3-E2E-01 Persona Runbook: Local Postgres

## Scope

This packet validates the current operator and developer CLI split against a
local Dockerized Postgres instance.

Source-of-truth commands in this runbook:

- operator bootstrap stays under `jin team ...`
- developer onboarding stays under `jin connect --team=<code>`
- local runtime verification stays under `jin start`, `jin status`, and direct
  Postgres queries

Current validation date:

- packet run on `2026-04-07`

## Persona Matrix

| Persona | Local environment | Command surface | Purpose | Validation status |
|---------|-------------------|-----------------|---------|-------------------|
| `team admin A` | canonical repo workspace + Docker Postgres on `localhost:5444` | `jin team schema ...`, `jin team bridge` | bootstrap the schema and mint one reusable onboarding code | automated and manually re-run |
| `dev A` | fresh temp home or laptop profile with one local repo remote | `jin connect --team=<code> --remote=<git-remote>`, `jin start`, `jin status` | join the shared workspace and run the local daemon path | onboarding automated, runtime push currently blocked |
| `dev B` | second fresh temp home or second laptop profile | `jin connect --team=<code> --remote=<git-remote>`, `jin start`, `jin status` | prove the bridge code can be reused by another developer without `jin team ...` access | runbook defined, not fully automated in this packet |

## Preconditions

Start local Postgres:

```sh
docker compose -f test/docker-compose.integration.yml up -d postgres
docker compose -f test/docker-compose.integration.yml ps
```

Connection string used below:

```sh
export JIN_LOCAL_PG='postgresql://jin_test:jin_test@localhost:5444/jin_test'
```

Optional cleanup between runs:

```sh
docker exec test-postgres-1 psql -U jin_test -d jin_test -c '
  DROP TABLE IF EXISTS public.jin_tool_calls CASCADE;
  DROP TABLE IF EXISTS public.jin_messages CASCADE;
  DROP TABLE IF EXISTS public.jin_conversations CASCADE;
  DROP TABLE IF EXISTS public.jin_meta CASCADE;
'
```

## Operator Flow: `team admin A`

Check the remote first:

```sh
bun src/index.ts team schema check --connection-string="$JIN_LOCAL_PG"
```

Expected on a fresh database:

```text
Remote: not initialized (jin_meta table does not exist)
Local:  v2.3
Action: run jin team schema apply
```

Apply the integration schema explicitly:

```sh
bun src/index.ts team schema apply --connection-string="$JIN_LOCAL_PG"
```

Re-check compatibility:

```sh
bun src/index.ts team schema check --connection-string="$JIN_LOCAL_PG"
```

Generate the bridge/onboarding code:

```sh
bun src/index.ts team bridge \
  --type=postgres \
  --connection-string="$JIN_LOCAL_PG" \
  --name=team-local-postgres
```

Share the emitted base64 code with developers exactly as printed:

```text
jin connect --team=<code>
```

## Developer Flow: `dev A`

Use a clean local profile so the run is repeatable:

```sh
export HOME="$(mktemp -d)"
export CODEX_HOME="$HOME/.codex"
export JIN_CONFIG_DIR="$HOME/.config/jin"
mkdir -p "$CODEX_HOME/sessions"
cp test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl \
  "$CODEX_HOME/sessions/2026-02-21T12-48-43-testcodex.jsonl"
```

Onboard with the operator-provided code and the repo remote:

```sh
bun src/index.ts connect \
  --team=<code> \
  --remote='https://github.com/testuser/testapp.git'
```

Expected config-side result:

```text
Connected remote:github.com/testuser/testapp -> team-local-postgres (postgres).
Changes will apply the next time jin starts.
```

Inspect the resulting local bindings:

```sh
bun src/index.ts connections
```

Start the local runtime and inspect local status:

```sh
bun src/index.ts start --foreground
# in a second shell:
bun src/index.ts status
```

Expected local runtime evidence:

- local store is populated
- sink `team-local-postgres` is enabled
- route count is non-zero

## Developer Flow: `dev B`

Repeat the same steps in a second clean local profile:

```sh
export HOME="$(mktemp -d)"
export CODEX_HOME="$HOME/.codex"
export JIN_CONFIG_DIR="$HOME/.config/jin"
bun src/index.ts connect \
  --team=<same-code> \
  --remote='https://github.com/acme/another-repo.git'
```

Then verify the second developer profile without any operator commands:

```sh
bun src/index.ts connections
bun src/index.ts status --json
```

## Verification Queries

Operator-side Postgres verification:

```sh
docker exec test-postgres-1 psql -U jin_test -d jin_test -c '
  SELECT value FROM public.jin_meta WHERE key = '\''schema_version'\'';
  SELECT count(*) AS conversations FROM public.jin_conversations;
  SELECT count(*) AS messages FROM public.jin_messages;
'
```

Developer-side CLI verification:

```sh
bun src/index.ts connections
bun src/index.ts status --short
```

## Automated Coverage In This Packet

Automated:

- `test/persona-local-postgres.test.ts`
  - operator can `schema check`, `schema apply`, `schema check` again
  - operator can generate a bridge code
  - developer `jin connect --team=<code> --remote=...` writes the expected sink
    and route config

Manual:

- foreground or detached local daemon execution against a fresh developer home
- local status inspection while runtime is active
- Postgres row verification after runtime ingest/push

## Current Observed Blocker

The operator/bootstrap and developer-onboarding surfaces work, but the final
runtime-to-Postgres proof is currently blocked outside this packet's owned
files.

Fresh-home reproduction observed during packet execution:

```sh
bun src/index.ts connect --team=<code> --remote='https://github.com/testuser/testapp.git'
bun src/index.ts ingest
```

Observed output:

```text
Done. scanned 1 refs, loaded 1 conversations, changed 1.
Push attempts: 1, pushed: 0, failed: 1.
```

Observed remote state after that run:

```text
public.jin_conversations = 0 rows
public.jin_messages      = 0 rows
```

That means this packet can provide a concrete runbook plus passing CLI/bootstrap
automation, but not a full green daemon-to-Postgres proof without crossing
into non-owned runtime/pipeline surfaces.

## Notes

- `test-harness/docker-compose.yml` still uses the compatibility alias
  `jin init --team=...`; treat the command sequences in this audit as the
  current source of truth for the operator/developer split.
- The recommended developer path for clean local validation is
  `jin connect --team=<code> --remote=<git-remote>` before `jin start`.
