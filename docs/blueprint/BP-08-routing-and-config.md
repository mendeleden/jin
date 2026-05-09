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

Config is durable intent. The running daemon owns an in-memory applied view of
that intent. Config changes do not take effect through ad hoc rereads in random
call sites; they take effect only through a coordinator-owned `config-reload`
transition or a full restart.

## Scope

BP-08 owns:
- **Durable config schema** — adapters, sinks, routes, watch settings
- **Route matching semantics** — glob patterns, AND logic, sink selection
- **Config-mutating commands** — connect, disconnect, route add/remove
- **Apply/reload semantics** — how config changes reach the runtime
- **Emergency runtime controls** — stop, sink disable/enable, sink repush

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
  teamId?: string;               // optional remote multi-tenant scoping
  userId?: string;               // optional export-side user identity
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

### Sink Export Metadata

`teamId` and `userId` are optional sink-scoped export metadata fields.

They are:

- not routing fields
- not workspace membership state
- not part of the canonical conversation snapshot

They exist so a configured sink can project stable export metadata into the
remote integration surface.

Why sink-scoped instead of top-level:

- different sinks may require different remote tenancy or attribution
- generic config stays explicit about which remote receives which metadata
- BP-08 still does not own workspace/team enrollment

---

## Config Lifecycle

### Loading

- Config lives at `~/.config/jin/config.json` (or `$JIN_CONFIG_DIR/config.json`)
- The runtime loads an initial config at startup and treats it as generation 0
  of the active runtime config
- Later changes are applied through a prioritized `config-reload` control work
  item
- The daemon may observe config changes from:
  - config-mutating Jin commands that write durable config
  - a best-effort filesystem watcher on `config.json` for manual edits
- first-party config-mutating commands must publish config atomically via
  durable replace semantics (temp file + fsync + rename, or equivalent)
- fail-closed invalid-config behavior applies to the published generation the
  daemon observes; manual in-place edits may therefore stop the runtime if they
  expose invalid config mid-save
- If a running daemon observes an invalid next config generation, it must stop
  and report the config error rather than continue serving the prior
  generation

**Why explicit reload instead of ad hoc hot-reload:** Config changes can
add/remove sinks, change routes, or disable adapters. These affect the
coordinator's adapter set, watcher paths, sink connections, and push
selection. Jin must therefore funnel config transitions through one explicit
coordinator-owned reload path rather than letting arbitrary subsystems reread
the file whenever they notice disk activity.

### First Run

`jin start` is the only bootstrap path (see BP-07 §First-Run Experience).
On a fresh machine with no config, `jin start` auto-detects adapters,
creates default config, and starts the runtime. There is no separate
`jin init` command.

On an existing machine, `jin start` may also materialize missing default
config stanzas into `config.json` before taking the initial runtime config
generation.
This is additive only: startup may write newly introduced adapter keys or
missing default sections, but it must not silently flip explicit user
choices or overwrite runtime/telemetry state into config.

This keeps the getting-started flow to one command:
```
jin start
```

### `jin sink add <type>`

Adds a sink definition to config. This is a low-level integration command
— it creates the destination, not the routing policy.

```
jin sink add postgres --connection-string="postgres://..." --id="postgres-team" --team-id="jin-team" --user-id="eden"
jin sink add s3 --bucket="jin-archive" --endpoint="..." --id="s3-archive" --user-id="eden"
jin sink add webhook --url="https://..." --id="webhook-alerts" --team-id="jin-team" --user-id="eden"
```

Optional sink-scoped export metadata:

- `--team-id=<value>` sets remote multi-tenant scoping metadata when the sink
  projects it
- `--user-id=<value>` sets export-side user identity when the sink projects it

These flags configure remote integration metadata only. They do not affect
route matching or the canonical local conversation model.

Steps:
1. Validate connection (healthCheck)
2. Add sink to `config.sinks[]`
3. **Prompt: "Add a route to this sink?"** — offers to create a route
   immediately so the sink starts receiving data
4. Write config atomically
5. If the daemon is running, trigger a prioritized config reload

A sink with no routes targeting it receives nothing. `jin status` warns:
```
Sinks:
  ✓ postgres-team    schema v2.0, 340/342 synced
  ⚠ s3-new           configured but no routes target this sink
                      Run: jin route add --remote="*" --sink=s3-new
```

`jin sink remove <id>` removes a sink definition and any routes that
reference it.

### `jin sink repush <id>`

Resets one sink's delivery checkpoint and replays the current local snapshot
to that sink only.

```
jin sink repush postgres-team
```

Semantics:

- requires the runtime to be stopped first
- deletes only `_jin_push_state` rows for the selected sink
- does **not** rewrite `_jin_sync`, local revisions, or canonical conversation
  content
- reuses the normal full-snapshot push path for the selected sink

This command exists for sink-side repair scenarios such as:

- adding or changing sink-scoped export metadata like `userId`
- backfilling after a remote schema fix
- replaying one destination after an operator mistake

It is intentionally sink-scoped. There is no top-level "repush everything"
surface in v2.

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

## Config Mutation and Live Apply

Config-mutating commands write durable config. By default, a running daemon
should absorb those changes through the prioritized `config-reload` path
without a full process restart.

### The Pattern

```
jin sink add postgres --connection-string="..." --user-id="eden"
  1. Validates connection (healthCheck)
  2. Writes config atomically
  3. If the daemon is running, trigger prioritized `config-reload`
  4. The coordinator reloads config, reconciles adapters/watchers/sinks,
     and future push work uses the new routes
```

Most config-mutating commands follow this pattern:

| Command | Mutates Config | Default Apply Path | Full Restart Optional? |
|---------|---------------|--------------------|------------------------|
| `jin sink add <type>` | Adds sink definition | Prioritized `config-reload` | Yes (`--yes`) |
| `jin sink remove <id>` | Removes sink + routes | Prioritized `config-reload` | Yes (`--yes`) |
| `jin sink disable/enable <id>` | Toggles sink delivery | Prioritized `config-reload` | Yes (`--yes`) |
| `jin route add ...` | Adds route | Prioritized `config-reload` | Yes (`--yes`) |
| `jin route remove ...` | Removes route | Prioritized `config-reload` | Yes (`--yes`) |
| `jin adapter enable/disable` | Toggles adapter | Prioritized `config-reload` | Yes (`--yes`) |

### Prioritized `config-reload`

`config-reload` is a control-plane event, not just another background task.

Requirements:

- it must jump ahead of ordinary queued `push` and periodic ingest work
- it must act as a real-time brake for the active runtime generation
- when a newer durable config generation is observed, the parent may cancel or
  kill in-flight workerized adapter/push work instead of waiting for the old
  generation to finish
- it must coalesce repeated config-disk churn into the latest durable config
- it must validate the next generation before resuming normal work
- if the next generation is invalid, the runtime must stop and surface the
  config error; it must not continue on the previous generation
- it must reload the whole config generation, not patch individual fields in
  place from scattered call sites
- the runtime must expose exactly one committed active generation and at most
  one newer observed generation awaiting validation/commit
- if multiple config writes arrive during validation or commit, the coordinator
  must coalesce them to the newest durable generation and retire earlier
  pending generations without serving them
- normal work admitted before commit stays tagged to the old generation and
  must be discarded once a newer generation commits

At a minimum, reload performs:

1. reread `config.json`
2. parse, normalize, and validate the entire next generation
3. if validation fails, stop the runtime with a fatal config error
4. interrupt any active old-generation adapter or push worker execution
5. rebuild the active sink set
6. refresh route selection inputs
7. refresh adapter config used for discovery/load and watcher reconciliation
8. reconcile watched paths and runtime timers against the new adapter set

Generation bookkeeping rules:

- events admitted after commit must carry the new active generation ID
- stale watcher/timer work from an older generation must never execute after
  commit
- the runtime status surface must show both the committed active generation and
  any newer observed generation while cutover is in flight (see BP-07)

This is the durable rule:

> Config changes become live only when the coordinator commits a
> `config-reload` transition or the process restarts. If the next config
> generation is invalid, the runtime stops instead of continuing on stale
> config.

### Service Mode

In service mode, live config reload remains the default path. The same
generation-cutover rules apply in foreground, daemon, and service mode. If the
operator explicitly requests `--yes`, the command delegates restart to the
service manager:
- macOS: `launchctl kickstart -k gui/${uid}/com.jin.agent`
- Linux: `systemctl --user restart jin.service`
- Windows: restart via Task Scheduler

The config-mutating command does not fork a new daemon. It writes config and
either:
- causes the running owner to perform the same daemon-owned
  `config-reload` generation cutover, or
- tells the service manager to restart if `--yes` was requested.

---

## Runtime Control Plane

Config mutation covers planned changes. But there are scenarios that need
immediate runtime control without a restart:

### Four Distinct Control Needs

| Need | Mechanism | Speed | When to use |
|------|-----------|-------|-------------|
| **Emergency stop** | `jin stop` | Immediate local brake | Panic — "stop everything NOW" |
| **Reconfigure** | Config mutation + prioritized `config-reload` | Immediate generation cutover | Planned change — add sink, update route, disable sink, retarget adapters |
| **Full recycle** | Config mutation + restart (`--yes`) | ~2 seconds | Force a clean process restart after a config change |
| **Selective replay** | `jin sink repush <id>` | Manual / bounded by push time | Repair — "re-deliver to this one sink" |

### Emergency Stop (`jin stop`)

In a panic ("I pushed a private repo to the wrong sink"), the user will
not remember sink IDs or think about routes. They will type `jin stop`.

**This is correct behavior.** `jin stop` is the emergency brake:

1. Triggers shutdown (BP-07)
2. Stops admitting new ingest/push work immediately
3. Aborts any Jin-local adapter/push worker execution still in flight
4. Data is safe in local SQLite
5. User investigates, fixes routes, restarts

**Blast radius:** Bounded by data that has already left Jin. Already-sent data
cannot be revoked — if an HTTP request, object upload, or SQL transaction
landed before the local brake, it landed. But Jin must not keep pushing the old
generation just because a large payload or batch was already underway.

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
- `disable` sets `enabled: false` on the sink in durable config and triggers
  the same prioritized `config-reload` path as any other config mutation
- Active push work that is still local to Jin should be interrupted
  immediately; already-landed remote writes cannot be revoked
- Other sinks continue pushing once the new generation commits
- Ingest continues under the new generation — data accumulates in the store
- Disable is **durable** — survives restart
- `enable` sets `enabled: true` and uses the same reconfigure path
- For permanent removal, use `jin sink remove <id> --yes`

**Why durable:** The "wrong sink / private data" scenario is exactly when
the user might panic-restart (`jin stop` then `jin start`). If disable
were ephemeral, the restart re-enables the sink and resumes pushing to the
wrong place. Durable disable means the sink stays off until the user
explicitly enables it.

**Why disable is no longer mechanically special:** v2 live apply treats all
delivery-affecting config changes as real-time brakes. `jin sink disable` is
still an important operator surface, but it should not require a sink-specific
runtime control lane separate from the main config generation cutover.

`jin status` shows disabled sinks clearly:
```
Sinks:
  ✓ postgres-team    schema v2.0, 340/342 synced
  ✕ s3-archive       DISABLED, 12 conversations queued
                      Run: jin sink enable s3-archive
```

**Implementation:** the coordinator rebuilds active sinks from durable config on
the next generation cutover. If an in-flight push worker is interrupted before
returning success, the parent records no new success for those payloads and
they remain dirty for a later retry.

### Selective Sink Repush

For the repair case — "this sink's remote state is wrong, replay current local
truth to that sink only":

```
jin sink repush <sink-id>
```

**Semantics:**
- runtime must be stopped to avoid competing write-capable coordinators
- Jin clears `_jin_push_state` for that sink only
- Jin leaves `_jin_sync` and local bundle revisions untouched
- Jin runs a one-shot push using the sink's current config and current routes
- diagnostics tag the replay as `reason=repush`

**Why not rewrite local revisions:** backfill pressure is an export-boundary
problem, not a canonical-store problem. Revisions describe local content
changes. Sink repush forgets one sink's delivery checkpoint instead of
pretending every conversation changed locally.

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
| Coordinator-owned config reload | Live apply is valuable, but only if the daemon owns the transition. Arbitrary call-site rereads would make push selection, sink lifecycle, and watcher reconciliation nondeterministic. |
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
