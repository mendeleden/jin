# Progress And Audit

This file defines how Cursor reports progress and how Codex decides a packet is
ready to merge.

## Authoritative Location

The authoritative live progress view is the shared control plane, not the
packet docs themselves.

- `docs/execution/` explains the system
- `.execution/` or another shared control directory records current state

## Status Vocabulary

Use these labels for blueprint progress:

- `unstarted`
- `frozen`
- `in_progress`
- `review_ready`
- `mostly_aligned`
- `aligned`
- `drifted`

These labels describe blueprint alignment, not amount of code written.

## Cursor Report Shape

Every Cursor audit should return:

- `Aligned`
  - code paths that match the cited BP sections
- `Drift`
  - code paths that conflict with the cited BP sections
- `Unowned spread`
  - files changed outside the packet's ownership boundary
- `Progress`
  - BP status labels for the blueprints touched by the packet
- `Codex decisions needed`
  - ambiguity, packet mismatch, or cross-lane conflict

Cursor should also:

- update `blueprints.md`
- write a review artifact under `reviews/`

## Codex Merge Gate

Codex should merge only when all of these are true:

- the worker stayed inside the packet boundary
- the diff implements the cited blueprint behavior
- tests named in the packet ran or there is a clear reason they could not
- Cursor found no unresolved drift
- any required bridge or integration glue is understood

## Progress Scoreboard

At minimum, keep one scoreboard line per blueprint:

```md
- BP-01: frozen
- BP-02: in_progress
- BP-03: frozen
- BP-04: review_ready
- BP-05: in_progress
- BP-06: unstarted
- BP-07: in_progress
- BP-08: in_progress
```

Optional but recommended:

- note which packet currently advances each BP
- note which packets are blocked by Codex decisions
- note the last reviewed packet touching each BP

## Drift Severity

Use simple severity buckets:

- `S1`
  - direct contradiction of a blueprint contract
- `S2`
  - boundary violation or unowned spread with likely semantic risk
- `S3`
  - incomplete alignment or missing coverage

## Important Rule

Cursor should report drift.
Cursor should not redefine the architecture.

Only Codex resolves conflicts between:

- current code
- packet intent
- blueprint intent

## Packet-State Rule

The live answer to "where is packet X?" should come from:

- `packets/<packet-id>.md`
- linked worker heartbeat file(s)
- linked review artifact(s)

not from reading branches and guessing.
