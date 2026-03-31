# W0-CURSOR-01: Drift Audit

## Role

Cursor only. Read-only lane.

## Goal

Audit active work against the blueprints and task packets. Report drift,
boundary spread, and blueprint progress.

## Depends On

- `docs/execution/00-global-rules.md`
- `docs/execution/02-progress-and-audit.md`
- the packet being reviewed

## Unblocks

- Codex review and merge decisions

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/02-progress-and-audit.md`
3. the task packet for the branch or diff under review
4. the BP docs cited by that packet
5. the changed files in the branch or diff

## Owned Files

No code ownership. Reports should be returned in the review channel, PR, or
chat surface in use.

## Forbidden Files

All repository files are read-only for this packet.

## Deliverables

- one audit report per reviewed diff
- one rolling blueprint progress summary
- explicit flag when a diff changed semantics outside its lane

## Report Shape

Return:

- `Aligned`
- `Drift`
- `Unowned spread`
- `Progress`
- `Codex decisions needed`

## Non-Goals

- rewriting architecture
- fixing code directly
- redefining packet scope

## Acceptance Checks

- every finding cites both a code path and a BP section
- severity is explicit
- progress labels describe blueprint alignment, not code volume

## Stop And Escalate

Escalate to Codex if:

- the packet and the blueprints disagree
- two packets appear to own the same responsibility
- the code seems correct but the packet is stale

## Completion Report

```md
Aligned:
- ...

Drift:
- ...

Unowned spread:
- ...

Progress:
- BP-01: ...
- BP-02: ...
- ...

Codex decisions needed:
- ...
```
