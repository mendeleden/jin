# Wave 3 State And Next Steps

- date: `2026-04-05`
- author: `codex-BRAIN`
- purpose: committed trail audit for the current execution state and next
  release-facing lane

## Current Approved State

- `W0` approved
- `W1` approved
- `W2` approved
- `W3-MODULE-01` approved and committed in `9178cc8`
- `W3-PRODUCT-01` approved and committed in `3bf6959`

## Next Active Release-Facing Lane

- `W3-STARTUP-01`
- title: `Protected Source Opt-In`
- reason: current startup behavior can probe protected or app-private adapter
  sources and trigger OS privacy prompts, especially on macOS

## Immediate Risks Still Open

- protected-source startup probing, especially Cursor on macOS
- legacy runtime/store bridge remains as a later hardening lane
- session-like API compatibility remains as a later hardening lane
- legacy adapter/sink/config compatibility surfaces remain as later hardening
  lanes
- BP-02 consecutive adapter error tracking remains a follow-up
- BP-06 minor-version warning remains a follow-up

## Prompt Trail

The current durable prompt set is:

- `docs/execution/prompts/codex-brain-cold-start-2026-04-05.md`
- `docs/execution/prompts/W3-STARTUP-01-worker.md`
- `docs/execution/prompts/W3-STARTUP-01-review.md`
- `docs/execution/prompts/W3-STARTUP-01-brain-intake.md`

## Control Plane Note

The live control plane remains `.execution/`, which is intentionally gitignored.
This file is only a committed snapshot and handoff trail.
