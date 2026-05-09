# W3-BP-02 Live Config Cutover CUJ Matrix

## Purpose

Turn the live config cutover blueprint changes into explicit operator and
developer journeys that future review and validation can reuse.

This matrix is intentionally doc-first. It does not prove implementation. It
defines the scenarios that the next council pass and later validation packets
should expect the runtime to satisfy.

## Personas

- `dev A`: runs a local daemon, changes routes/sinks while actively ingesting
  and pushing local data
- `privacy responder`: notices a wrong-destination incident and wants Jin to
  stop cooperating immediately
- `service operator`: runs Jin under launchd/systemd and needs non-opaque fatal
  config visibility

## CUJ Matrix

| ID | Persona | Trigger | Core assertion |
|----|---------|---------|----------------|
| `CUJ-01` | `privacy responder` | `jin stop` during an active push worker | stop is a real-time local brake; no completed `PushResult`, no local success |
| `CUJ-02` | `dev A` | `jin sink disable` or `jin route remove` during an active push worker | config mutation publishes a newer generation and interrupts stale delivery immediately |
| `CUJ-03` | `dev A` | repeated route/sink edits while reload is already in flight | the coordinator coalesces to the newest durable generation and retires earlier pending ones |
| `CUJ-04` | `dev A` | manual invalid `config.json` edit while daemon mode is running | invalid next config is fail-closed; Jin stops instead of serving stale config |
| `CUJ-05` | `service operator` | invalid `config.json` while service mode keeps relaunching | repeated relaunch attempts do not hide the fatal config reason from `jin status` |
| `CUJ-06` | `dev A` | restart after interrupted push worker | dirty backlog replays from SQLite and `_jin_push_state` advances only from completed parent-confirmed results |

## Scenario Details

### CUJ-01: Panic Stop During Active Push

Trigger:
- a large push is in flight and the user wants Jin to stop immediately

Expected contract:
- `jin stop` prevents new normal work from being admitted
- the parent cancels or kills the active adapter/push worker immediately
- no new `_jin_push_state` success is recorded for payloads still in that
  worker
- the runtime exits `stopped`, not `degraded`
- any already-landed remote writes remain an external blast radius, not a local
  success record

Required visibility:
- lifecycle state transitions to `stopping` and then `stopped`
- interruption counters increment
- diagnostics record an abandoned-delivery event with generation and sink
  context
- dirty backlog remains local and replay-eligible

BP anchors:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`

### CUJ-02: Real-Time Route or Sink Change

Trigger:
- a sink is disabled or a route is removed while a push worker is already
  active

Expected contract:
- the command writes config atomically
- the runtime observes a newer config generation and enters prioritized
  `config-reload`
- active stale-generation push work is interrupted immediately
- the new generation becomes active only after rebuild/reconcile completes
- future push selection uses the new routes/sink enablement
- other unaffected sinks continue once the new generation commits

Required visibility:
- `status` shows the old active generation, the newer observed generation while
  reload is in flight, and the newer active generation after commit
- diagnostics show the interruption and the remaining dirty backlog

BP anchors:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-08-routing-and-config.md`

### CUJ-03: Coalesced Config Churn

Trigger:
- the user or editor produces multiple config writes while a prior reload is
  still validating or committing

Expected contract:
- the coordinator does not serve each intermediate generation
- earlier pending generations are retired before commit
- the newest durable generation wins
- old queued work tagged to retired generations does not execute later

Required visibility:
- `reload_state` shows that cutover is in progress
- status or diagnostics identify the newest observed generation
- stale-work retirement is visible in logs or structured diagnostics

BP anchors:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-08-routing-and-config.md`

### CUJ-04: Invalid Config in Daemon Mode

Trigger:
- the daemon observes a manually edited `config.json` that is malformed or
  otherwise invalid

Expected contract:
- the runtime validates the next generation before commit
- invalid config stops the runtime fail-closed
- Jin does not continue on the previous generation
- the fatal error is preserved for later inspection

Required visibility:
- `status` shows `stopped` plus the last fatal config error
- diagnostics identify the rejected observed generation and reason
- the operator can distinguish this from ordinary degradation

BP anchors:
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`

### CUJ-05: Invalid Config in Service Mode

Trigger:
- launchd/systemd keeps trying to run Jin after an invalid config change

Expected contract:
- the runtime still fails closed on invalid config
- service relaunch attempts do not create a silent stale-runtime fallback
- `jin status` exposes the fatal config reason even if the runtime is not
  currently healthy

Required visibility:
- the last fatal config error remains queryable outside the crashed process
- service ownership remains visible
- operators can tell the difference between "service is installed" and "runtime
  is healthy"

BP anchors:
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`

### CUJ-06: Replay After Interrupted Push Worker

Trigger:
- Jin restarts or resumes after a stop/reload interrupted a push worker

Expected contract:
- SQLite remains the source of truth
- interrupted payloads stay dirty because no completed parent-confirmed
  `PushResult` was recorded
- the next valid runtime replays that backlog
- at-least-once semantics are preserved even if the remote already received
  bytes before interruption

Required visibility:
- replay backlog is visible by sink or destination
- interruption history remains visible long enough to explain why replay
  happened
- success state advances only after a completed replay push returns

BP anchors:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`

## Review Expectations

The next council pass should use this matrix to answer:

1. Is the generation-cutover contract explicit enough to implement without
   guessing?
2. Do the operator-visible status/diagnostic requirements explain interruption,
   invalid config, and replay clearly enough?
3. Does any CUJ still imply a hidden second path instead of the one live
   `config-reload` mechanism?
