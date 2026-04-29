---
title: "BP-09: CLI Split — jin vs jin team"
status: draft
created: 2026-04-06
depends-on: [BP-01, BP-08, BP-Product-Strategy]
informs: []
---

# BP-09: CLI Split — jin vs jin team

## Purpose

This blueprint defines the command-level boundary between jin as the local
developer CLI and jin team as the operator/workspace CLI.

It answers:

> Which commands belong to the developer? Which belong to the operator?
> Where does Team stop being a sink and start being a product?

This is the concrete command-surface companion to BP-Product-Strategy, which
established the principle but did not prescribe exact command names.

---

## Decision: Single Binary, Two Namespaces

Jin ships as **one binary**. Developer commands live at the top level
(`jin start`, `jin show`, `jin connect`). Operator/workspace commands live
under a `jin team` subcommand group (`jin team bridge`, `jin team schema apply`).

There is no separate `jin-team` binary.

### Why not a separate binary

- Adds distribution, versioning, and `$PATH` complexity for zero user
  benefit today
- The operator who runs `jin team schema apply` is often the same person
  who runs `jin start` on a dev box — one install, two hats
- If Team ever needs a standalone server process, that is a different
  artifact (`jin-server` or similar), not the CLI

### Why a subcommand group

- Creates a clear namespace boundary visible in help text and tab-complete
- `jin team` commands can be documented, discovered, and gated separately
- Matches the BP-Product principle: developer and operator workflows are
  different personas, not different products

---

## Developer Commands (`jin`)

These are local-first, product-oriented, and require no remote workspace
knowledge.

### Lifecycle

| Command | Purpose |
|---------|---------|
| `jin start [--foreground\|--service]` | Start the local daemon (bootstraps on first run) |
| `jin stop` | Stop the daemon |
| `jin restart` | Restart the daemon |
| `jin status [--json\|--short]` | Daemon health, adapter status, sink state |

### Data Queries

| Command | Purpose |
|---------|---------|
| `jin conversations [--adapter --since --limit]` | List local conversations |
| `jin show <id> [--trace\|--tree\|--json]` | Show a conversation, trace, or tree |
| `jin search "query" [--since --adapter]` | FTS search over local conversations |
| `jin stats [--since --adapter --json]` | Token/cost analytics |
| `jin export [--format=json\|md]` | Export conversations |

### Workspace Onboarding (Developer Side)

| Command | Purpose |
|---------|---------|
| `jin connect --team=<code>` | Decode bridge code, create sink + route, preserve bridge export metadata |
| `jin connect <repo> --sink=<id>` | Route a repo to an existing destination |
| `jin connections` | Show current routing and destinations |
| `jin disconnect <repo>` | Remove routing |

`connect --team=<code>` is the developer's entry point to a workspace.
The developer does not need to know what kind of sink backs the workspace.
When the bridge payload contains sink-scoped export metadata such as
`teamId` or `userId`, `connect --team=<code>` must preserve those values
exactly when materializing sink config.

### Integration Wiring (BYO / Power User)

| Command | Purpose |
|---------|---------|
| `jin sink add <type> [--team-id --user-id] ...` | Add a generic integration destination |
| `jin sink remove <id>` | Remove a destination |
| `jin sink disable\|enable <id>` | Durable destination control |
| `jin sink repush <id>` | Reset one sink's delivery state and backfill it |
| `jin route add ... --sink=<id>` | Add routing rules |
| `jin route remove ...` | Remove routing rules |

These remain first-class per BP-Product principle 3 (integrations are not
legacy leftovers).

### Utility

| Command | Purpose |
|---------|---------|
| `jin ingest` | One-shot ingest without daemon |
| `jin benchmark [--json]` | Measure ingest budgets |
| `jin service install\|uninstall\|status` | OS service management |
| `jin update` | Self-update |
| `jin version` | Print version |

---

## Operator/Workspace Commands (`jin team`)

These are workspace-oriented, deployment-oriented, or require operator-level
access. They appear in the `jin team` subcommand group, not in the developer's
primary path.

### Initial Operator Surface

The first `jin team` implementation should stay narrow. It owns:

| Command | Purpose |
|---------|---------|
| `jin team bridge [--team-id --user-id]` | Generate an onboarding bridge code for developers |
| `jin team schema apply <connection>` | Apply jin tables to an existing Postgres database |
| `jin team schema check <connection>` | Read-only version compatibility check |
| `jin team schema version` | Print expected local schema version |

### Reserved (Future, Not Initial Implementation)

These remain future-facing until workspace identity is real and no longer
heuristic in the local config:

| Command | Purpose |
|---------|---------|
| `jin team init` | Guided interactive workspace setup |
| `jin team status` | Workspace health, connected developers, push state |
| `jin team disconnect` | Remove workspace identity/binding cleanly |
| `jin team invite <email>` | When auth/identity exists |
| `jin team members` | When identity exists |
| `jin team config` | Workspace-level settings once a real Team plane exists |

### Schema Management (Operator Escape Hatch)

| Command | Purpose |
|---------|---------|
| `jin team schema apply <connection>` | Apply jin tables to an existing Postgres database |
| `jin team schema check <connection>` | Read-only version compatibility check |
| `jin team schema version` | Print expected local schema version |

## Operator Bridge: `jin team bridge`

`jin team bridge` generates a bridge code encoding sink credentials plus
optional sink-scoped export metadata. It is an operator command — it requires
knowing connection strings, bucket names, webhook URLs, or remote attribution
settings.

Relevant flags:
- `--team-id=<value>` for sink-scoped remote multi-tenant metadata
- `--user-id=<value>` for sink-scoped export-side user identity

Why:
- "team-config" is ambiguous (configure the team? show team configuration?)
- "bridge" is what the output actually is — the help text already calls it
  a "workspace onboarding bridge"
- It belongs in the `jin team` namespace because it is an operator action,
  not a developer action

---

## Schema Apply: `jin team schema apply`

### What It Is

An explicit operator escape hatch for provisioning jin's Postgres schema on
a self-managed database. It creates the tables jin expects (`jin_conversations`,
`jin_messages`, `jin_tool_calls`, `jin_meta`, sync tables) and sets the schema
version in `jin_meta`.

### What It Is Not

- Part of the developer onboarding story
- Shown in the main `jin` help text
- Run automatically by `jin start` or `jin connect`
- A replacement for managed deployment migration (Jin Team owns its own
  backend story)

### Why `jin team schema apply`

| Candidate | Problem |
|-----------|---------|
| `jin schema apply` | Top-level placement makes it look like a core command |
| `jin-team db init` | Separate binary; "db init" implies creating the database |
| `jin team db init` | "db init" implies creating the database itself |
| `jin team schema apply` | Precise: apply a schema layer to an existing database |
| `jin team schema migrate` | Implies data migration, not DDL application |

"Apply" is the right verb because jin is applying its expected table layout
to an existing database. It is not creating the database, not migrating
data, and not initializing a server.

### Behavior

```
jin team schema apply --connection-string="postgres://..."

1. Connect to the database
2. Check if jin_meta exists
   - If yes: read schema_version, compare to local version
     - Match: "Schema v2.3 already applied. No changes needed."
     - Remote ahead: "Remote schema v2.4 is newer than local v2.3. Update jin."
     - Remote behind: repair/add missing columns, update jin_meta
   - If no: create all tables, insert schema_version into jin_meta
3. Print result
```

### Companion: `jin team schema check`

Read-only. Reports version compatibility without writing anything.

```
jin team schema check --connection-string="postgres://..."

  Remote: v2.3 (compatible)
  Local:  v2.3
  Tables: jin_conversations, jin_messages, jin_tool_calls, jin_meta  [OK]
```

Useful for CI/CD pipelines and health monitoring.

For schema revisions that add integration metadata columns, `jin team schema`
must verify and repair the table shape, not just compare version strings.

---

## How `connect --team=<code>` Relates to `jin team`

`connect --team=<code>` stays in the developer namespace. The developer
receives a bridge code from their operator and runs one command. They do
not need to understand what `jin team` is.

The flow:

```
Operator                              Developer
--------                              ---------
jin team schema apply <conn>          (nothing — operator handles infra)
jin team bridge --type=webhook --user-id=eden ...    (nothing — operator generates code)
  → shares code with developer        jin connect --team=<code>
                                        → sink + route created
                                        → data starts flowing
```

The bridge code format is an implementation detail. Today it may encode
sink configuration and optional export metadata. In the future it could be
a workspace URL that triggers an OAuth flow. `connect --team=<value>` should
be format-agnostic — interpret the value based on its shape (bridge blob vs
URL vs token).

---

## Help Text Structure

### Main `jin` help

```
jin v0.x — local daemon and conversation index for coding-tool activity

Local:
  start [--foreground|--service]       Start the local daemon
  stop                                 Stop the daemon
  restart                              Restart the daemon
  status [--json|--short]              Daemon health and destination status
  conversations [--adapter=X]          List local conversations
  search "query" [--since=7d]          Search local content
  show <id> [--trace|--tree|--json]    Show a conversation, trace, or tree
  stats [--since=30d]                  Token and cost analytics
  export [--format=json|md]            Export conversations

Connect:
  connect --team=<code>                Join a workspace
  connect <repo> --sink=<id>           Route a repo to a destination
  connections                          Show current routing
  disconnect <repo>                    Remove routing

Integrations:
  sink add <type> [--team-id --user-id] ...
                                       Add an integration destination
  sink remove <id>                     Remove a destination
  sink disable|enable <id>             Durable destination control
  route add ... --sink=<id>            Add routing rules
  route remove ...                     Remove routing rules

Workspace (operator):
  team <subcommand>                    Workspace bootstrap, schema, status
                                       Run 'jin team help' for details

Utility:
  ingest                               One-shot local ingest
  benchmark [--json]                   Measure ingest budgets
  service install|uninstall|status     OS service management
  update                               Self-update
  version                              Show version

Primary path:  jin start
Config:        ~/.config/jin/config.json
Help:          jin help <command>
```

### `jin team help`

```
jin team — workspace bootstrap and operator tools

Bootstrap:
  bridge --type=<sink> [--team-id --user-id] ...
                                       Generate a developer onboarding code

Schema (operator escape hatch):
  schema apply <connection>            Apply jin tables to a Postgres database
  schema check <connection>            Check schema version compatibility
  schema version                       Print expected schema version

Future:
  init                                 Reserved for guided workspace setup
  status                               Reserved until workspace identity is real

These commands are for workspace operators, not everyday developers.
Developers join a workspace with: jin connect --team=<code>
```

---

## Module Map Impact

BP-01 lists `commands/schema.ts` as a planned file. Under this blueprint:

```
src/commands/
  team.ts              # jin team dispatch (routes to sub-commands)
  team-bridge.ts       # jin team bridge
  team-schema.ts       # jin team schema apply|check|version

Future:

```
src/commands/
  team-status.ts       # when workspace identity is real
  team-init.ts         # interactive workspace setup
```
```

The `team.ts` dispatcher is a thin router, similar to how `sink` and
`route` sub-actions are dispatched in `index.ts` today.

---

## One-Way Doors (Contract Invariants)

| Invariant | Why It Is a One-Way Door |
|-----------|--------------------------|
| `jin team` is a subcommand group, not a separate binary | Splitting later requires new distribution, versioning, and install paths. Merging back is easy. |
| `connect --team=<code>` stays in the developer namespace | Moving it into `jin team connect` breaks every onboarding guide and bridge code printout. |
| `jin team schema apply` is explicit and never automatic | If schema apply ever runs implicitly (during `start` or `connect`), the developer/operator boundary is broken and cannot be re-established without breaking workflows. |
| Bridge code format is opaque to the developer | The developer passes an opaque value to `connect --team=`. Changing the interpretation (base64 today, URL tomorrow) is safe as long as the flag interface stays stable. |

---

## Risks

### Risk 1: `jin team` becomes a Postgres sink with a hat

The danger is implementing `jin team init` as "create a Postgres sink and
call it team." Guard against this by making `jin team init` workspace-oriented
(name, identity, bridge code generation) rather than sink-oriented. The
sink is an implementation detail of the workspace.

### Risk 2: `jin team schema apply` leaks into the developer path

If documentation says "Step 1: `jin team schema apply`; Step 2:
`jin connect --team=<code>`" the boundary is broken. The schema command
must appear only in operator/admin documentation, never in developer
onboarding guides.

### Risk 3: Naming collision with future Team server

If Jin Team eventually has a server process, `jin team` the CLI namespace
and a hypothetical `jin-team` server binary could collide. Reserve
`jin team serve` or use a different artifact name for the server. Do not
use `jin team start`.

### Risk 4: `connect --team=<code>` format lock-in

The bridge code is currently a base64-encoded JSON blob containing sink
credentials. If the Team product later uses an API-based onboarding flow
(OAuth, workspace token, URL), the `--team` flag must handle both formats.
Design the flag to be format-agnostic: detect shape (base64 blob vs URL vs
token) and dispatch accordingly.

### Risk 5: `bridge` naming opacity

"Bridge" is internal jargon. Alternative names worth considering:
`jin team invite-code`, `jin team onboard-code`, `jin team generate-code`.
"Bridge" is acceptable if documentation explains the concept; "invite-code"
is more self-documenting for operators who have not read the blueprints.

---

## Validation Plan

### Experiment 1: Namespace Discovery

Run `jin help` and `jin team help`. Verify that a developer sees local
commands first and workspace commands only under `jin team`. Verify that
an operator can find `schema apply` without reading developer docs.

### Experiment 2: Onboarding Flow

1. Operator: `jin team schema apply --connection-string=...`
2. Operator: `jin team bridge --type=webhook --url=... --team-id=jin-team --user-id=eden`
3. Developer: `jin connect --team=<code>`
4. Developer: `jin status` shows the workspace sink

Verify that at no point does the developer need to run a `jin team` command.

### Experiment 3: BYO Integration Independence

1. Power user: `jin sink add postgres --connection-string=... --user-id=eden`
2. Power user: `jin route add --remote="github.com/org/*" --sink=my-pg`

Verify that this path works without touching `jin team` at all. Generic
sinks remain first-class.

### Experiment 4: Removed Compatibility Bridges

1. Run `jin team-config --type=webhook --url=...`
2. Verify it fails and points to `jin team bridge`
3. Run `jin init`
4. Verify it fails and points to `jin start`
5. Run `jin sessions`
6. Verify it fails and points to `jin conversations`

---

## Migration Path from Current CLI Surface

| Step | Change | Breaking |
|------|--------|----------|
| 1 | Add `jin team` subcommand dispatch in `index.ts` | No |
| 2 | Add `jin team bridge` with current `teamConfigCommand` logic | No |
| 3 | Add `jin team schema apply`, `check`, `version` | No |
| 4 | Remove `jin team-config`, `jin init`, `jin sessions`, and `jin ui` from the developer surface | Yes |
| 5 | Remove `jin connect --postgres|--s3|--webhook` shortcut wiring | Yes |
| 6 | Add `jin team init` once workspace identity/product behavior exists | No |
| 7 | Add `jin team status` once workspace identity is no longer heuristic | No |

---

## What This Blueprint Does NOT Cover

| Topic | Where |
|-------|-------|
| Team backend, auth, or hosted control plane | Future Team product spec |
| Remote API server architecture | Future blueprint |
| Sink contract or push semantics | BP-06 |
| Route matching mechanics | BP-08 |
| Process lifecycle | BP-07 |
| Desktop boundary | BP-07 and GitHub issue #34 |
| Config schema changes for team metadata | BP-08 amendment if needed |

---

## References

- [BP-Product-Strategy](BP-Product-Strategy.md) — product boundaries
  (Team is a product plane, not a sink flavor)
- [BP-01](BP-01-module-map.md) — module map (`commands/schema.ts` planned)
- [BP-08](BP-08-routing-and-config.md) — routing, config mutation,
  `connect` / `disconnect` reserved for workspace onboarding
- [W3-TEAM-01](../execution/tasks/W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md)
  — the execution packet that prompted this blueprint
