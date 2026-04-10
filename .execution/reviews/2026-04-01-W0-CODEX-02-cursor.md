# Review: W0-CODEX-02 Live Control Plane Bootstrap

- reviewer: `cursor-audit`
- packet: `W0-CODEX-02`
- date: `2026-04-01`
- verdict: `needs_codex` (one S3 text bug, otherwise clean)

## Scope Of Review

Audited the W0-CODEX-02 live control plane bootstrap against:

- the W0-CODEX-02 task packet (`docs/execution/tasks/W0-CODEX-02-live-control-plane-bootstrap.md`)
- the execution OS spec (`docs/execution/00-global-rules.md`, `01-dispatch-protocol.md`, `02-progress-and-audit.md`, `05-live-control-plane.md`, `README.md`)
- the seeded live control plane (`.execution/**`)
- the control plane templates (`docs/execution/templates/control-plane/**`)
- the launch prompts (`docs/execution/prompts/first-codex-session.md`, `first-cursor-session.md`)

Changes attributable to W0-CODEX-01 (contract freeze) were excluded.

## Aligned

### Static/live split — `05-live-control-plane.md` §Why This Exists, `README.md` §Static Vs Live

The two-layer design is coherent and well-documented:

- `docs/execution/` is the committed, reviewable spec — explains how the system works.
- `.execution/` is the gitignored live state — records what is happening now.
- `.execution/README.md` correctly points back to `docs/execution/05-live-control-plane.md` as the authoritative spec.
- `.gitignore` correctly excludes `.execution/`.

This separation means branches and merges do not overwrite live state, and live
state does not pollute committed history. The design addresses the exact
weakness the packet identifies.

### Ownership model — `05-live-control-plane.md` §Ownership Model, §Concurrency Rule

Clean three-way ownership split is stated consistently across all three
locations where it appears:

- `05-live-control-plane.md` §Ownership Model and §Concurrency Rule
- `01-dispatch-protocol.md` §Live State Files
- `README.md` §Core Roles

Codex owns `program.md` and `packets/*.md`. Cursor owns `blueprints.md` and
`reviews/*.md`. Workers own only `agents/*.md`. No file has ambiguous or
overlapping ownership.

### Dispatch protocol update — `01-dispatch-protocol.md` §Worker Prompt Skeleton

The worker prompt skeleton now tells fresh agents to read control plane state
before starting work. The skeleton explicitly lists `program.md`,
`blueprints.md`, and the relevant packet file. This satisfies `00-global-rules.md`
§2 Fresh-Context Principle, which was updated to include "the live control
plane" in the required resource list.

### Launch prompts — `prompts/first-codex-session.md`, `prompts/first-cursor-session.md`

Both prompts now include `05-live-control-plane.md` in the read list and
instruct agents to read the shared control directory before editing. They
reference `$JIN_EXEC_CONTROL_DIR` for non-canonical locations. Aligned with
`01-dispatch-protocol.md` §The Shared Control Directory.

### Templates — `docs/execution/templates/control-plane/`

All 5 templates (program, blueprints, packet, agent, review) exist and match
the field lists in `05-live-control-plane.md` §Required Files. The seeded
`.execution/` files follow these templates structurally.

### Seeded control plane — `.execution/`

- `program.md` — phase, packet state, active agents, next dispatches, blockers.
  All fields from `05-live-control-plane.md` §Required Files are present.
- `blueprints.md` — all 9 BPs listed with status, active packet, last review,
  blocker. Matches `02-progress-and-audit.md` §Progress Scoreboard.
- `packets/` — 19 packet files covering all Wave 0–3 packets in
  `docs/execution/README.md` §Packet Catalog. Each follows the template.
- `agents/` — `codex-contract-freeze-01.md` and `codex-control-plane-01.md`
  present for the two Codex W0 sessions. Format matches template.
- `reviews/` — `2026-04-01-W0-CODEX-01-cursor.md` present from the prior audit.

### §6 Live Control Plane Rule — `00-global-rules.md`

New rule §6 is additive. Existing rules (§1–§5) are content-unchanged; only
renumbered (old §6→§7, §7→§8, §8→§9). The new rule codifies what the dispatch
protocol and control plane spec already require, making it a global obligation
rather than implicit from reading `05-live-control-plane.md`. No existing
semantics were altered.

### §Packet-State Rule — `02-progress-and-audit.md`

New section makes explicit that the live answer to "where is packet X?" comes
from the control plane, not from branch inspection. Aligned with the Central
Progress Rule in `README.md` and the rationale in `05-live-control-plane.md`
§Why This Exists.

### W0-CODEX-01 semantics preserved

W0-CODEX-02 does not alter any contract-freeze semantics. The changes to
`00-global-rules.md` are additive (new §6, renumbering). The frozen contracts
in `src/contracts/**` and `docs/execution/04-frozen-contract-surface.md` are
untouched. The W0-CODEX-01 packet file in `.execution/packets/W0-CODEX-01.md`
correctly shows `status: approved` with the prior review linked.

## Drift

### S3 — `01-dispatch-protocol.md` line 7: "exactly four things" lists five items

- **File:** `docs/execution/01-dispatch-protocol.md` line 7
- **Rule:** internal consistency of the dispatch protocol spec
- **Finding:** The text says "Every dispatch should include exactly four
  things" but the numbered list now has 5 items (after inserting
  `05-live-control-plane.md` as item 3). The word "four" was not updated to
  "five".
- **Severity:** S3 — incomplete alignment, no semantic risk, but a fresh agent
  reading this will notice the contradiction.
- **Fix:** Change "four" to "five" on line 7.

## Unowned Spread

None.

All committed changes in the `6427d51` diff are within W0-CODEX-02 scope:

- `docs/execution/05-live-control-plane.md` — new file, core deliverable
- `docs/execution/README.md` — updated to describe the control plane layer
- `docs/execution/00-global-rules.md` — new §6 rule, renumbering
- `docs/execution/01-dispatch-protocol.md` — control directory, live state
  sections added
- `docs/execution/02-progress-and-audit.md` — authoritative location, Cursor
  duties, packet-state rule added
- `docs/execution/prompts/first-codex-session.md` — control plane reading added
- `docs/execution/prompts/first-cursor-session.md` — control plane reading added
- `docs/execution/tasks/W0-CODEX-02-live-control-plane-bootstrap.md` — task
  packet for this work
- `docs/execution/templates/control-plane/*` — 5 templates, core deliverable
- `.gitignore` — `.execution/` exclusion

No W0-CODEX-01 files were modified. No implementation code was touched.

## Progress

No blueprint status change is needed from this packet. W0-CODEX-02 is an
execution-system packet, not a blueprint-implementation packet. All BPs remain
`frozen` per the W0-CODEX-01 review.

## Codex Decisions Needed

1. **Fix the "four things" text in `01-dispatch-protocol.md` line 7.** Change
   "four" to "five". This is trivial but blocks clean approval because a fresh
   agent following the dispatch protocol will encounter a self-contradictory
   instruction. Codex should fix this and then move W0-CODEX-02 to `approved`.

## Observation (Outside W0-CODEX-02 Scope)

The agent heartbeat at `.execution/agents/claude-w1-routing-01.md` shows
`status: in_progress` while the corresponding packet
`.execution/packets/W1-ROUTING-01.md` shows `status: queued` and
`assigned agent: unassigned`. Per `01-dispatch-protocol.md` §Required State
Transitions §1, Codex must update the packet file before dispatch. This is a
live-state consistency issue for Codex to resolve in the next program update,
not a W0-CODEX-02 defect.
