# Frozen Contract Surface

This file publishes the shared v2 contracts that Wave 1 workers must treat as
read-only.

## Codex-Owned Files

These files are the frozen contract surface for Wave 1:

- `src/contracts/conversations.ts`
- `src/contracts/adapters.ts`
- `src/contracts/store.ts`
- `src/contracts/sinks.ts`
- `src/contracts/config.ts`
- `src/contracts/lifecycle.ts`
- `src/contracts/pipeline.ts`
- `src/contracts/index.ts`

Workers may import these files. Workers may not edit them unless Codex issues a
new packet that explicitly re-opens the freeze.

## Frozen Decisions

- conversation identity and relationship semantics are `traceId`,
  `parentId`, `relationship`, and `forkPoint`
- adapter work is discover/load based: `findChanged(hint?)` then
  `loadConversation(ref)`
- the adapter output unit is `ConversationBundle`
- store writes are hash-gated `writeBundle()` calls that return
  `{ changed, revision }`
- push uses full snapshots with `attemptedRevision`
- sink push results report errors per conversation
- routing matches `remote`, `adapter`, `branch`, and `name`
- unmatched conversations push nowhere by default
- config is a runtime snapshot, not a hot-reloaded control plane
- lifecycle keeps one long-lived owner per local store
- graceful shutdown has a 15 second drain budget

## Allowed Migration Shims

The repo still contains v1-era files that may remain temporarily while Wave 1
ports land:

- `src/adapters/types.ts`
- `src/sinks/types.ts`
- `src/config.ts`
- `src/routing.ts`
- `src/store.ts`
- `src/commands/watch.ts`
- `src/lifecycle.ts`

Allowed shim rule:

- a lane may keep the current runtime compiling while it ports its owned area
- a lane may add only the minimal bridge explicitly allowed by its packet
- a lane may not add new semantics to the legacy shim surface
- new semantics belong in the lane implementation plus the frozen contracts

## Wave 1 Ownership Map

| Packet | Reads Frozen Files | Allowed Bridge | Must Not Redefine |
|---|---|---|---|
| `W1-ADAPTER-01` | `src/contracts/adapters.ts`, `src/contracts/conversations.ts` | adapter-local imports only | adapter interface, parsed shapes, relationship semantics |
| `W1-DB-01` | `src/contracts/conversations.ts`, `src/contracts/store.ts`, `src/contracts/sinks.ts` | minimal `src/store.ts` bridge already called out in packet | bundle hash, revision, push-state semantics |
| `W1-PIPE-01` | `src/contracts/adapters.ts`, `src/contracts/store.ts`, `src/contracts/sinks.ts`, `src/contracts/config.ts`, `src/contracts/lifecycle.ts`, `src/contracts/pipeline.ts` | integration through `src/pipeline/**` only | queue ownership, push payload, shutdown contract |
| `W1-ROUTING-01` | `src/contracts/config.ts`, `src/contracts/conversations.ts` | replacement inside `src/config.ts` and `src/routing.ts` | route fields, AND semantics, safe zero-state |
| `W1-LIFECYCLE-01` | `src/contracts/lifecycle.ts`, `src/contracts/config.ts`, `src/contracts/pipeline.ts` | lifecycle implementation files only | ownership model, runtime states, shutdown budget |
| `W1-SINK-01` | `src/contracts/sinks.ts`, `src/contracts/conversations.ts`, `src/contracts/config.ts` | webhook-local implementation only | `PushPayload`, `PushResult`, `attemptedRevision` |

## Stop Rule For Workers

If a Wave 1 packet needs a change to any file under `src/contracts/**`, stop
and escalate to Codex instead of patching around the freeze.
