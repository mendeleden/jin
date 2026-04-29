---
name: "execution-os"
description: "Use when the user wants work structured through Jin's execution OS: create or update execution packets, worker/review prompts, live control-plane state, embedded Mermaid dependency status, or detached codex exec or reviewer lanes."
---

# Execution OS

Use this skill when the request is about Jin's packetized execution workflow rather than direct product code changes.

Typical triggers:

- "create a packet"
- "queue a review packet"
- "spin up workers/reviewers"
- "run codex exec"
- "update the control plane"
- "show the dependency graph"
- "do a wider BP/spec audit"

Do not use this skill for a normal single-lane code fix unless the user explicitly wants the execution OS machinery around it.

## Read Order

Read only the minimum needed, in this order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. the relevant file(s) under `docs/execution/templates/control-plane/`
5. the relevant packet under `docs/execution/tasks/`, if it already exists
6. only the BP docs and code files named by that packet
7. `docs/execution/prompts/agent-launch-cookbook.md` if you will launch a detached worker or reviewer

Do not rediscover the architecture from the whole repo. Follow the packet boundary model.

## Core Rules

- `docs/blueprint/` is the source of truth.
- Do not silently extend frozen contracts.
- Prefer updating an existing packet over inventing a second packet for the same lane.
- Keep ownership narrow. If a lane needs broader ownership, record that explicitly in the packet instead of smuggling extra edits through implementation.
- Always treat review as a first-class artifact, not an afterthought.

## Output Set

When this skill is invoked, the default output set is:

1. a packet in `docs/execution/tasks/`
2. a worker prompt in `docs/execution/prompts/`
3. a review prompt in `docs/execution/prompts/`
4. if the lane is live, control-plane updates under `.execution/`
5. if needed, an embedded Mermaid dependency update in `.execution/program.md`

Only create the files the user actually needs. Do not spray placeholder docs.

## Packet Authoring

Create or update the packet using the repo template shape, not an ad hoc outline.

Minimum packet content:

- role
- goal
- depends on
- unblocks
- read in order
- owned files
- forbidden files or boundaries
- acceptance checks
- BP Acceptance Matrix
- V1 Comparison

Required packet habits:

- `Depends On` and `Unblocks` must be concrete.
- `Read In Order` should name exact BP docs and code files.
- `Ownership` must be explicit enough that a fresh worker can stay in bounds.
- If the packet affects checklists, runbooks, or release notes, say which live-state files must be revalidated before approval.

## Prompt Authoring

Create one worker prompt and one review prompt per non-trivial lane.

### Worker prompt

The worker prompt should:

- name the packet
- list the required read order
- list owned files
- list forbidden files or frozen boundaries
- restate the validation target
- require the completion report format from `00-global-rules.md`

### Review prompt

The review prompt should:

- be review-only
- identify the packet and review artifact path
- name the BP docs in scope
- tell the reviewer to verify the BP Acceptance Matrix and V1 Comparison
- require findings first, ordered by severity

## Live Control Plane

If the lane is active, update the control plane deliberately:

- `codex-BRAIN` owns:
  - `.execution/program.md`
  - `.execution/packets/<packet-id>.md`
- reviewers own:
  - `.execution/blueprints.md`
  - `.execution/reviews/*.md`
- workers own:
  - `.execution/agents/*.md`

Do not cross those write boundaries casually.

When dispatching or updating a live lane:

- keep packet status current
- keep assigned agent/session name current
- keep next Codex action current
- keep latest review reference current

## Mermaid And Dependency Updates

Prefer the embedded Mermaid graph inside `.execution/program.md` for live dependency state.

Use Mermaid updates when:

- packet dependencies changed
- active packet status changed in a way the operator needs to see
- a wide audit needs a compact status graph

Do not create standalone `.mmd` files unless one of these is true:

- you are updating an existing first-class blueprint Mermaid artifact under `docs/blueprint/mermaid/`
- the user explicitly asked for a standalone diagram
- the packet explicitly owns a generated diagram artifact

When you do update a graph:

- keep it derived from packet/control-plane truth
- update `Depends On` / `Unblocks` and the graph together
- do not let the graph drift from packet state

## `codex exec` Dispatch

When launching Codex worker/reviewer lanes, use `docs/execution/prompts/agent-launch-cookbook.md`.

Default launch expectations:

- detached `tmux`
- stable session names such as:
  - `codex-WORKER-<task-slug>`
  - `codex-REVIEWER-<task-slug>`
- logs under `.execution/logs/`
- `codex exec --full-auto --json`
- `-o` for the last assistant message

Do not default to interactive TUIs unless a human explicitly wants to drive the lane live.

## Wider Sweeps And Audits

When the user wants a broad audit, split by surface instead of giving five agents the same vague task.

Good audit slices:

- runtime/store/data flow
- adapters/watchers/contract
- sinks/routing/config
- lifecycle/service/start-stop/status
- CI/release/validation

Each reviewer should:

- read the same source-of-truth BP docs
- own a disjoint surface
- return concrete drift, not generic summaries

Then synthesize:

- common root causes
- immediate blockers
- cleanup priorities
- whether the problem is code drift, spec drift, or validation drift

## Decision Rules

Use these defaults:

- If the user wants structure first, write the packet before touching product code.
- If the lane crosses a frozen contract, stop and surface the drift instead of hiding it inside the packet.
- If the lane is non-trivial, queue review in parallel with or immediately after implementation.
- If a previous packet/review already exists for the lane, extend it instead of cloning a near-duplicate packet.

## Completion Standard

Before calling the execution-OS work done, verify:

- packet exists or was updated
- prompts exist or were updated
- control-plane state is current if the lane is live
- Mermaid/live dependency view is current if dependencies changed
- worker/reviewer launch path is explicit if detached runs were requested
- BP Acceptance Matrix and V1 Comparison are accounted for

If any of those are intentionally skipped, say so explicitly.
