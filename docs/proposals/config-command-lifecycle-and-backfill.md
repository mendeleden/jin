---
title: Config Command Lifecycle, Tool Materialization, and Sink Backfill
status: discussion
created: 2026-04-19
depends-on: [BP-07, BP-08]
informs: []
---

# Config Command Lifecycle, Tool Materialization, and Sink Backfill

## Why This Discussion Exists

The current config/runtime split is much better than it was, but the operator
story is still not crisp enough in three places:

1. first-run bootstrap for a real user machine
2. "you installed a new tool while Jin was already running"
3. "you added a new sink or route and now need historical backfill"

These are product-level UX questions that sit on top of BP-08's current
low-level config mutation rules.

## Desired Operator Story

The target experience should be:

1. install Jin
2. run one obvious bootstrap command
3. opt into protected sources like Cursor private storage explicitly
4. let Jin keep config and runtime intent in sync without hidden behavior
5. add sinks/routes later without forcing adapter re-ingest to backfill

## Topic 1: Bootstrap / Install Script

We need a crisp onboarding path that is better than "manually edit
`~/.config/jin/config.json` after the first start."

Recommended direction:

- keep `jin start` as the bootstrap entrypoint
- add an install/bootstrap script or command that makes the first-run choices explicit
- keep protected-source opt-in explicit, never silent

Concrete shape worth discussing:

```sh
curl ... | sh
jin start
jin config set adapters.cursor.allowProtectedSource true --yes
```

Or, if we want one higher-level affordance:

```sh
jin setup
jin setup --enable-cursor-private
```

Rule:

- generic defaults can be materialized automatically
- protected/private source access must stay opt-in

## Topic 2: New Tool Installed While Jin Is Running

The confusing case is:

1. user starts Jin
2. later installs Cursor/Codex/another adapter-backed tool
3. running daemon detects it
4. runtime starts acting on it
5. config file still looks stale or incomplete

That is an operator trust problem.

Recommended direction:

- if the running daemon detects a newly available known adapter whose policy is
  already implied by normalized defaults, Jin should materialize the missing
  adapter stanza into `config.json`
- this should be additive only
- it should never silently flip an explicit user choice
- it should emit a clear notice in status/log output

Example:

```json
"cursor": {
  "enabled": true,
  "allowProtectedSource": false
}
```

That tells the truth:

- Cursor is now a known managed adapter
- protected/private storage is still off
- the user can opt in explicitly later

Important distinction:

- config materialization is allowed
- runtime telemetry is not config

We should not write things like:

- last-seen source paths
- cache counters
- dynamic health state

into `config.json`.

## Topic 3: Sink Add / Route Change / Historical Backfill

The operator story here should be:

1. add sink
2. add or update route
3. apply config safely
4. backfill historical conversations from the local store

The key product rule should be:

- adding a sink must **not** require adapter re-ingest
- backfill should come from the canonical local store

That means "backfill" is a push concern, not an adapter concern.

Recommended direction:

- `jin sink add ... --yes` performs controlled restart if needed
- `jin route add ... --yes` performs controlled restart if needed
- then Jin offers an explicit backfill action

Concrete shape worth discussing:

```sh
jin sink add postgres --connection-string=... --id=team --yes
jin route add --remote="github.com/acme/*" --sink=team --yes
jin push backfill --sink=team --remote="github.com/acme/*"
```

Or a bundled flow:

```sh
jin connect my-repo --sink=team --backfill
```

Backfill semantics should be:

- compute matching historical conversations from store state
- mark them dirty for the target sink(s)
- let the normal push pipeline deliver them
- do not rescan adapters just to backfill

This keeps the store as the system of record and avoids mixing config mutation
with re-ingest work.

## Topic 4: Runtime Apply Semantics

We should keep the rule simple:

- additive config materialization can happen during lifecycle hooks
- behavior-changing config still requires a controlled restart unless BP-08
  explicitly defines a hot-path exception

Examples:

- adding a missing adapter stanza: safe additive materialization
- changing `allowProtectedSource`: restart
- adding a sink: restart
- adding a route: restart
- sink disable/enable: already the explicit BP-08 exception

## Topic 5: What `jin status` Should Explain Better

If Jin is running and the operator changes config or installs a new tool,
`jin status` should explain:

- whether config on disk differs from runtime snapshot
- whether a new adapter was materialized into config during runtime
- whether a restart is required for a pending change
- whether a sink/route change has historical backlog available for backfill

## Recommended Decision

If we want a crisp product story, the simplest durable policy is:

- `jin start` remains the bootstrap command
- lifecycle hooks may materialize additive config defaults and newly detected
  adapter stanzas
- protected/private sources stay explicit opt-in
- sink/route changes remain config mutations plus controlled restart
- historical backfill is store-driven push work, never adapter re-ingest

## Open Questions

1. Do we want a dedicated `jin setup` / install script, or should `jin start`
   plus targeted config commands remain the only bootstrap surface?
2. Should reconcile-time adapter materialization write config immediately, or
   should it only stage a notice for the next `jin start`?
3. Should backfill be a separate `jin push backfill ...` command, or an option
   on `jin sink add`, `jin route add`, and `jin connect`?
4. Do we want `jin status` to surface "pending restart because config changed"
   explicitly?
