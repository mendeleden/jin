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

## 5. Implementation Rules

- Prefer building a clean v2 path over half-mutating a messy v1 path.
- Keep diffs narrow and reviewable.
- Add or update tests for the behavior named in the packet.
- Do not disable or delete tests to get green.
- Do not change fixtures, snapshots, or generated outputs unless the packet
  needs that change.
- If a bridge from old code to new code is needed, keep the bridge explicit.

## 6. Live Control Plane Rule

- Live multi-agent status must be recorded in the shared control plane, not
  inferred from git alone.
- The shared control plane is usually `.execution/`, or another directory
  selected via the dispatch protocol.
- Workers must read the current control-plane state before starting work.
- Workers must update their own live heartbeat/progress state while working.
- Codex must update packet assignment and transition state.
- Cursor must update review artifacts and the blueprint scoreboard.

## 7. Stop Conditions

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

## 8. Required Completion Report

Every worker handoff must use this exact structure:

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-XX: sections implemented

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```

## 9. Review Contract

Before a worker diff is accepted:

- Codex checks blueprint alignment
- Codex checks boundary discipline
- Cursor checks drift and packet spread

No packet is complete until that review loop finishes.
