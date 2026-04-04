# Global Rules

These rules apply to every execution packet.

## 1. Source Of Truth

- `docs/blueprint/` is the source of truth.
- If current code conflicts with the blueprints, fix the code.
- Do not silently revise BP meaning in code.
- Do not edit BP files unless the packet explicitly says to do so.

## 2. Fresh-Context Principle

- Assume every worker starts with no prior memory.
- A worker must be able to succeed from:
  - this file
  - the dispatch protocol
  - the live control plane
  - one task packet
  - the exact BP docs and code files named in that packet
- Do not require a worker to rediscover the architecture from the whole repo.

## 3. Boundary Discipline

- Stay inside the owned files listed in the packet.
- Treat forbidden files as read-only reference material.
- Do not make unrelated cleanup edits.
- Do not "just tweak one more file" outside the lane.
- If a packet boundary feels wrong, stop and escalate to Codex instead of
  violating it.

## 4. Contract Freeze Rule

Unless the packet explicitly authorizes it, workers must not change:

- conversation identity and relationship semantics
- adapter interface semantics
- store revision or bundle-hash semantics
- push payload or push result semantics
- routing semantics
- lifecycle ownership semantics

These are one-way doors and remain Codex-owned until frozen and delegated.

## 5. BP Completeness Rule

- Packet approval requires **completeness**, not just local alignment.
- Every packet must account for each relevant blueprint requirement in scope.
- Each packet and worker handoff must include a **BP Acceptance Matrix** that
  marks every in-scope requirement as exactly one of:
  - implemented, with code file and test citation
  - deferred, with explicit Codex approval
  - out of scope, with boundary citation
- Missing in-scope BP requirements are not "future hardening" by default.
  They are incomplete packet work until Codex explicitly defers them.
- Frozen constants and frozen types are part of the completeness check only
  when they correspond to an in-scope BP requirement for the packet.

## 6. V1 Regression Rule

- If a packet rewrites or replaces a v1-era surface, the worker must compare
  the v2 diff against the prior v1 behavior.
- The packet or handoff must include a **V1 Comparison** section that records
  one of:
  - parity preserved
  - intentional change, with BP citation
  - deferred regression, with explicit Codex approval
- If no prior surface exists, say `no prior v1 surface` explicitly.

## 7. Implementation Rules

- Prefer building a clean v2 path over half-mutating a messy v1 path.
- Keep diffs narrow and reviewable.
- Add or update tests for the behavior named in the packet.
- Do not disable or delete tests to get green.
- Do not change fixtures, snapshots, or generated outputs unless the packet
  needs that change.
- If a bridge from old code to new code is needed, keep the bridge explicit.

## 8. Live Control Plane Rule

- Live multi-agent status must be recorded in the shared control plane, not
  inferred from git alone.
- The shared control plane is usually `.execution/`, or another directory
  selected via the dispatch protocol.
- Workers must read the current control-plane state before starting work.
- Workers must update their own live heartbeat/progress state while working.
- `codex-BRAIN` must update packet assignment and transition state.
- reviewers must update review artifacts and the blueprint scoreboard.

## 9. Role Names

Use these names consistently in prompts, heartbeats, and operator conversation:

- `codex-BRAIN`
  - sole control-plane and integration role
- `codex-WORKER-<task-slug>`
  - implementation lane for one packet or one tight cluster of packet-owned work
- `cursor-REVIEWER-<task-slug>` or `claude-code-REVIEWER-<task-slug>`
  - review-only lane for one packet, batch, or audit focus

The role name is the operator-facing name.
The backing heartbeat filename may differ during a transition, but the live
control plane should make the mapping explicit.

## 10. Stop Conditions

Stop and hand back to Codex if:

- the task requires touching a forbidden file
- a frozen contract must change
- the packet and blueprint disagree
- the packet and current code disagree in a way that changes ownership
- the work becomes cross-cutting

When stopping, return:

- what blocked progress
- which file or contract caused it
- what decision Codex must make

## 11. Required Completion Report

Every worker handoff must use this exact structure:

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

BP alignment:
- BP-XX: sections implemented

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```

## 12. Review Contract

Before a worker diff is accepted:

- `codex-BRAIN` checks blueprint alignment
- `codex-BRAIN` checks packet completeness against the BP Acceptance Matrix
- `codex-BRAIN` checks V1 regression handling when the packet rewrites an
  existing surface
- `codex-BRAIN` checks boundary discipline
- a reviewer checks drift, packet spread, and whether all in-scope BP
  requirements were either implemented, deferred, or boundary-excluded

No packet is complete until that review loop finishes.
