---
title: "BP-08: Routing & Configuration"
status: draft
created: 2026-03-29
depends-on: [BP-01, BP-02, BP-06, BP-07]
informs: []
---

# BP-08: Routing & Configuration

## Principle

Routing is a pure function: given a conversation and a set of route rules,
return which sinks should receive it. The pipeline (BP-02) calls this
function at push time — it does not persist routing decisions. Config
defines the rules; routing evaluates them.

Config is durable intent. The running daemon is a snapshot of that intent.
Changing config requires either restarting the daemon or using a
config-mutating command that performs a controlled restart on the caller's
behalf.

## Scope

BP-08 owns:
- **Durable config schema** — adapters, sinks, routes, watch settings
- **Route matching semantics** — glob patterns, AND logic, sink selection
- **Config-mutating commands** — connect, disconnect, route add/remove
- **Apply/restart semantics** — how config changes reach the runtime
- **Emergency runtime controls** — stop, sink disable/enable

BP-08 does NOT own:
- **Workspace/team enrollment** — how a developer joins a team workspace,
  receives pre-seeded config, or connects to managed sinks. This is a
  product-level concern (see BP-Product-Strategy) that layers on top of
  the config primitives defined here.
- **Desktop boundary API** — see BP-07 and GitHub issue #34.
- **Managed deployment config provisioning** — see BP-07 §Managed
  Deployment.

---

## Route Matching

A route matches a conversation when **all specified fields** match. Fields
use glob patterns. Omitted fields match anything.

```typescript
type RouteMatch = {
  remote?: string;     // glob against conversation.git_remote
  adapter?: string;    // glob against conversation.adapter_id
  branch?: string;     // glob against conversation.branch
  name?: string;       // glob against conversation.name
};

type RouteConfig = {
  match: RouteMatch;
  sinks: string[];     // sink IDs from config
};
```

### Rules

- Multiple fields = **AND** (all specified fields must match)
- Each field is a glob pattern (supports `*` and `?`)
- Omitted field = matches anything (implicit wildcard)
- `remote` matching is **case-insensitive** — `git_remote` is normalized
  before matching: lowercase, strip `.git` suffix, trim trailing slashes
- `adapter` matching is **case-insensitive** — adapter IDs are lowercase
  by convention
- `branch` and `name` matching are **case-sensitive** — branch names like
  `fix/Auth` and `fix/auth` are distinct in git, and conversation names
  should match exactly what the user sees

### Examples

```json
// Route all conversations from one repo
{ "match": { "remote": "github.com/acme/api" }, "sinks": ["postgres-team"] }

// Route all Cursor conversations to an analytics webhook
{ "match": { "adapter": "cursor" }, "sinks": ["webhook-cursor"] }

// Route a monorepo branch to a staging sink (AND: both must match)
{ "match": { "remote": "github.com/acme/mono", "branch": "staging" }, "sinks": ["postgres-staging"] }

// Wildcard: route all company repos to archive
{ "match": { "remote": "github.com/acme/*" }, "sinks": ["s3-archive"] }
```

---

## Sink Selection Algorithm

```
route(conversation, routes, allSinks) → Sink[]

1. Evaluate each route in order against the conversation
2. Collect ALL matching routes (not first-match-wins)
3. Union the sink IDs from all matching routes
4. If no route matches: conversation is not pushed (safe zero-state)
5. Return sinks matching those IDs
```

**Why union (all matches) instead of first-match-wins:**

A conversation from `github.com/acme/api` on branch `staging` might match
both the company-wide archive route AND a staging-specific route. Both
sinks should receive it. First-match-wins forces careful route ordering and
duplicated sink IDs across routes.

**Default behavior:**

| Scenario | Result |
|----------|--------|
| No routes configured | Nothing pushed — safe zero-state |
| Routes configured, none match | Nothing pushed — conversation is local-only |
| Routes configured, some match | Union of matching route sinks |

**No `defaultSinks`.** There is no catch-all fallback. Every pushed
conversation must match at least one explicit route. This is a deliberate
safety choice: negative-space routing ("everything that isn't matched goes
here") is hard to reason about, hard to audit, and causes accidental
pushes when new repos, new adapters, or personal projects appear.

To push everything, write an explicit wildcard route:
```json
{ "match": {}, "sinks": ["postgres-team", "s3-archive"] }
```

This is visible in the route table, auditable in `jin status`, and
intentional. It is not a hidden default that silently captures new
conversations the user hasn't thought about.

### Conversation Columns Available for Routing

| Field | Example | Populated By |
|-------|---------|-------------|
| `git_remote` | `github.com/acme/api` | Adapter (from `git remote get-url origin`) |
| `adapter_id` | `claude-code`, `cursor` | Adapter (always set) |
| `branch` | `fix/auth-middleware` | Adapter (from `git branch --show-current`) |
| `name` | `Fix auth middleware bug` | Adapter (from first user message) |

**Why `cwd` is not a routing field:** It's an accident of where someone
cloned the repo. Three engineers on the same project have three different
`cwd` values. Use `git_remote` for project identity (see ontology.md §5).

---

## Config Schema

```typescript
type JinConfig = {
  adapters: Record<string, AdapterConfig>;
  sinks: SinkConfig[];
  routes: RouteConfig[];
  watch: WatchConfig;
};

type AdapterConfig = {
  enabled: boolean;
  dataDir?: string;              // override default data path
};

type WatchConfig = {
  pollIntervalMs: number;        // periodic full scan (default 60000)
};
```

### Sink Config (Discriminated Union)

```typescript
type SinkConfig = PostgresSinkConfig | S3SinkConfig | WebhookSinkConfig;

type SinkConfigBase = {
  id: string;                    // unique, referenced by routes
  type: "postgres" | "s3" | "webhook";
  enabled: boolean;              // false = durably disabled via `jin sink disable`
};

type PostgresSinkConfig = SinkConfigBase & {
  type: "postgres";
  connectionString: string;
};

type S3SinkConfig = SinkConfigBase & {
  type: "s3";
  bucket: string;
  region?: string;               // default "us-east-1"
  endpoint?: string;             // for R2/MinIO
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;               // default "jin/"
  pathStyle?: boolean;           // true for MinIO
};

type WebhookSinkConfig = SinkConfigBase & {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;            // default 30000
};
```

The `type` field narrows the union. No more flat bag of optional fields.

---

## Config Lifecycle

### Loading

- Config lives at `~/.config/jin/config.json` (or `$JIN_CONFIG_DIR/config.json`)
- Loaded **once** at startup, snapshotted for the session (BP-07 invariant)
- Changes to the config file require restart to take effect
- No hot-reload in v2

**Why no hot-reload:** Config changes can add/remove sinks, change routes,
or disable adapters. These affect the coordinator's adapter set, watcher
paths, and sink connections. Applying mid-run safely would require a
config-change work item in the coordinator queue with full adapter/sink
reconciliation. The restart cost is ~2 seconds (re-ingest is fast because
bundle hashes skip unchanged data via BP-05).

### First Run

`jin start` is the only bootstrap path (see BP-07 §First-Run Experience).
On a fresh machine with no config, `jin start` auto-detects adapters,
creates default config, and starts the runtime. There is no separate
`jin init` command.

This keeps the getting-started flow to one command:
```
jin start
```

### `jin sink add <type>`

Adds a sink definition to config. This is a low-level integration command
— it creates the destination, not the routing policy.

```
jin sink add postgres --connection-string="postgres://..." --id="postgres-team"
jin sink add s3 --bucket="jin-archive" --endpoint="..." --id="s3-archive"
jin sink add webhook --url="https://..." --id="webhook-alerts"
```

Steps:
1. Validate connection (healthCheck)
2. Add sink to `config.sinks[]`
3. **Prompt: "Add a route to this sink?"** — offers to create a route
   immediately so the sink starts receiving data
4. Write config; prompt to restart if daemon is running

A sink with no routes targeting it receives nothing. `jin status` warns:
```
Sinks:
  ✓ postgres-team    schema v2.0, 340/342 synced
  ⚠ s3-new           configured but no routes target this sink
                      Run: jin route add --remote="*" --sink=s3-new
```

`jin sink remove <id>` removes a sink definition and any routes that
reference it.

### `jin route add` / `jin route remove`

Manages the routing policy separately from sink definitions:

```
jin route add --remote="github.com/acme/*" --sink=postgres-team
jin route add --adapter="cursor" --sink=webhook-alerts
jin route add --sink=s3-archive               # wildcard: match everything
jin route remove --sink=postgres-team --remote="github.com/acme/*"
```

### Reserved: `connect` / `disconnect`

`connect` and `disconnect` are reserved for workspace/team onboarding —
a higher-level product concept that bundles sink provisioning, route
creation, and team enrollment into one guided flow. See BP-Product-Strategy.

For v2, use `jin sink add` / `jin sink remove` and `jin route add` /
`jin route remove` for integration config.

---

## Config Mutation and Controlled Restart

Config-mutating commands write durable config. They do not hot-patch the
live runtime. Instead, they can optionally trigger a controlled restart.

### The Pattern

```
jin sink add postgres --connection-string="..." --yes
  1. Validates connection (healthCheck)
  2. Writes sink to config.json
  3. --yes: stops running daemon → starts it again (config reloaded)
     (no --yes: prints "Restart jin to apply changes")
```

Most config-mutating commands follow this pattern:

| Command | Mutates Config | Restartable |
|---------|---------------|-------------|
| `jin sink add <type>` | Adds sink definition | Yes (`--yes`) |
| `jin sink remove <id>` | Removes sink + routes | Yes (`--yes`) |
| `jin route add ...` | Adds route | Yes (`--yes`) |
| `jin route remove ...` | Removes route | Yes (`--yes`) |
| `jin adapter enable/disable` | Toggles adapter | Yes (`--yes`) |

**Exception — `jin sink disable/enable`:** See §Selective Sink Disable
below. Disable writes durable config AND signals the runtime immediately
without a full restart. This is an explicit exception to the "config
changes require restart" rule because disable is an operator safety
control that must take effect within seconds, not after a restart cycle.

### Why Not Hot-Reload

Hot-reload requires:
- Adapter set reconciliation (watchers, caches)
- Sink connection lifecycle (open new, close removed)
- Route evaluation against new rules mid-push
- Coordinator awareness of config transitions

Controlled restart gets all of this for free — the startup sequence
(BP-07) handles it. The cost is ~2 seconds of downtime during which no
pushes occur. Data is safe in SQLite.

### Service Mode

In service mode, `--yes` delegates restart to the service manager:
- macOS: `launchctl kickstart -k gui/${uid}/com.jin.agent`
- Linux: `systemctl --user restart jin.service`
- Windows: restart via Task Scheduler

The config-mutating command does not fork a new daemon. It writes config
and tells the service manager to restart.

---

## Runtime Control Plane

Config mutation covers planned changes. But there are scenarios that need
immediate runtime control without a restart:

### Three Distinct Control Needs

| Need | Mechanism | Speed | When to use |
|------|-----------|-------|-------------|
| **Emergency stop** | `jin stop` | Immediate (seconds) | Panic — "stop everything NOW" |
| **Reconfigure** | Config mutation + restart | ~2 seconds | Planned change — add sink, update route |
| **Selective disable** | `jin sink disable <id>` | Immediate | Calm — "stop pushing to this one sink" |

### Emergency Stop (`jin stop`)

In a panic ("I pushed a private repo to the wrong sink"), the user will
not remember sink IDs or think about routes. They will type `jin stop`.

**This is correct behavior.** `jin stop` is the emergency brake:

1. Triggers graceful shutdown (BP-07)
2. In-flight push completes current batch (max 20 conversations)
3. All pushes stop
4. Data is safe in local SQLite
5. User investigates, fixes routes, restarts

**Blast radius:** Bounded by one push batch (20 conversations × N sinks).
If the user types `jin stop` within seconds of noticing the problem, at
most one or two batches have been sent. Already-sent data cannot be
revoked — if an HTTP request or SQL batch landed, it landed.

**Recovery:** Fix config (`jin route remove`, `jin sink remove`), then
`jin start`. The store retains all data. Push resumes only to sinks
targeted by the corrected routes.

### Selective Sink Disable

For the calmer case — "I want to stop pushing to one sink while I
investigate, without stopping ingest or other sinks":

```
jin sink disable <sink-id>
jin sink enable <sink-id>
```

**Semantics:**
- `disable` sets `enabled: false` on the sink in durable config AND
  signals the runtime so the coordinator skips this sink immediately
- Other sinks continue pushing normally
- Ingest continues — data accumulates in the store
- Disable is **durable** — survives restart
- `enable` sets `enabled: true` and signals the runtime
- For permanent removal, use `jin sink remove <id> --yes`

**Why durable:** The "wrong sink / private data" scenario is exactly when
the user might panic-restart (`jin stop` then `jin start`). If disable
were ephemeral, the restart re-enables the sink and resumes pushing to the
wrong place. Durable disable means the sink stays off until the user
explicitly enables it.

**Why disable is an exception to the no-hot-patch rule:** Most config
changes (add sink, add route) require restart because they affect the
coordinator's adapter set, watcher paths, and sink connections. Disable is
different — it only sets a filter flag that `pushDirty()` checks before
including a sink. No reconnection, no watcher change, no adapter
reconciliation. The runtime can absorb this change safely without a full
restart cycle.

`jin status` shows disabled sinks clearly:
```
Sinks:
  ✓ postgres-team    schema v2.0, 340/342 synced
  ✕ s3-archive       DISABLED, 12 conversations queued
                      Run: jin sink enable s3-archive
```

**Implementation:** `pushDirty()` checks `sink.enabled` before including
a sink. No new work queue item type — it's a filter, not a work item.
`disable` writes config and signals the runtime via the daemon boundary
so the change takes effect immediately without a full restart.

### Queue Self-Heal After Crash

If jin is killed (SIGKILL, OOM, power loss):
- In-memory queue entries are lost
- But all durable state is intact:
  - SQLite transactions roll back cleanly
  - Push backlog is derived from store revisions (`_jin_sync` +
    `_jin_push_state`), so un-pushed conversations are retried
  - Startup full scan re-detects everything the watcher missed
- Already-delivered remote writes may replay (sinks must tolerate
  at-least-once delivery — BP-06)

The store is the safety net. The queue is ephemeral coordination, not
durable state.

---

## What Was Removed From v1

| v1 Concept | v2 Replacement |
|-----------|---------------|
| `projects` table | `git_remote` column on conversations |
| `session_projects` M:N join | Gone — direct column read |
| `RouteMatch.project` | `RouteMatch.remote` (git remote glob) |
| `RouteMatch.directory` | Removed — unreliable across machines |
| `routeUnmatchedToAll` flag | Wildcard route: `{ match: {}, sinks: [...] }` |
| `defaultSinks` config field | Removed — no catch-all fallback. Use explicit wildcard route. |
| `store.rawDir` | Removed (never used) |
| `team.syncMode` | Removed (never read) |
| `team.syncIntervalMs` | Removed (never read) |
| Flat `SinkConfig` bag | Discriminated union by `type` |
| First-match-wins routing | All-matches union |
| String equality matching | Glob patterns |

---

## One-Way Doors (Contract Invariants)

| Invariant | Why It's a One-Way Door |
|-----------|------------------------|
| Routing is a pure function at push time | If routing were persisted at ingest time, changing routes wouldn't affect already-ingested conversations. Pure-function means route changes take effect on next push. |
| AND semantics for multi-field matches | Changing to OR breaks existing routes that rely on "remote AND branch" narrowing. |
| Glob patterns (not regex) | Switching to regex changes every route in every config file. Globs cover 99% of use cases and are simpler. |
| `git_remote` as primary routing key | Config, deployment guides, and route examples all use git_remote. Reverting to cwd breaks cross-machine routing. |
| No default/fallback sinks | Every push requires an explicit route match. Adding a catch-all later is easy (wildcard route). Removing an accidental catch-all after data has been pushed is not. Safe zero-state is a one-way door. |
| Config snapshot at startup | Adding hot-reload requires coordinator work items for config transitions. Snapshot is simpler and avoids mid-push route changes. |
| SinkConfig discriminated union | Code that switches on `type` depends on the union structure. Flattening back to a bag breaks type narrowing everywhere. |

---

## Validation Plan

### Experiment 1: Glob Matching

Create 5 conversations with different `git_remote` values and 3 routes
with glob patterns. Assert `route()` returns correct sinks per conversation.

### Experiment 2: AND Semantics

Route with `remote` + `branch`. Assert match requires BOTH fields, not
either.

### Experiment 3: No Route = No Push

Conversations matching no routes → assert empty sink set (not pushed).
Verify `jin status` correctly reports "matched by no route" for these.

### Experiment 4: Union vs First-Match

Two routes matching same conversation with different sinks. Assert both
sink sets are returned (union), not just the first.

---

## What This Blueprint Does NOT Cover

| Topic | Where |
|-------|-------|
| Push scheduling and eligibility | BP-02 |
| Sink interface and families | BP-06 |
| Schema version handshake | BP-06 (table sinks) |
| Adapter detection and watchPaths | BP-04 |
| Store schema and migrations | BP-05 |
| Process lifecycle and daemon modes | BP-07 |
| Workspace/team enrollment and managed deployment | BP-Product-Strategy |
| Desktop boundary API and shared type contracts | GitHub issue #34 |
| End-to-end type safety across CLI/daemon/Desktop | GitHub issue #34 |
