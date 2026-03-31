---
name: lfg
description: Full compound engineering pipeline — office hours, brainstorm, plan, review plan, implement, review code, resolve, compound. Use for non-trivial features or phase work.
argument-hint: "[feature or task description]"
---

# LFG: $ARGUMENTS

Full compound engineering loop for the work described above.

## Pipeline

### Phase 0: Office Hours (if the problem is fuzzy)

If the user isn't sure *what* to build or *whether* to build it, run `/office-hours $ARGUMENTS`.

Skip if:
- The problem is clear and well-defined
- This is a known bug fix or roadmap item
- The user has already decided what they want

**Gate**: If office hours was run, wait for the user to confirm the reframed problem before continuing.

### Phase 1: Brainstorm (if multiple approaches exist)

If the task has competing approaches, run `/brainstorm $ARGUMENTS`.

Skip if:
- Only one viable approach exists
- A plan already exists in `docs/plans/`
- The user explicitly said what to do

**Gate**: If brainstorm was run, wait for the user to choose an approach before continuing.

### Phase 2: Plan

Run `/plan $ARGUMENTS` to create an implementation plan.

- Research codebase, review docs, roadmap, and ontology
- Design with file-level specificity
- Save plan to `docs/plans/`

**Gate**: Present plan. Don't proceed without explicit approval.

### Phase 3: Plan Review (recommended for non-trivial work)

Run both reviews on the plan:

1. `/plan-product-review [plan]` — Is this the right thing? (scope, value, timing, cost)
2. `/plan-arch-review [plan]` — Is this the right way? (v2 compliance, risk, simplicity, test coverage)

Skip if:
- The change is small and well-understood
- The user says "skip reviews, just build it"

**Gate**: Both reviews pass, or concerns are addressed. If either review says "Revise" or "Reject", go back to Phase 2.

### Phase 4: Guard (if touching dangerous areas)

If the work touches schema, migration logic, ID generation, PID files, or sink push behavior, activate `/guard`.

This sets a behavioral contract for the implementation phase — pause-and-confirm before destructive operations.

### Phase 5: Work

Run `/work [plan-name]` to implement the approved plan.

- Execute step by step with task tracking
- Run `bun run typecheck` after TS changes
- Run `bun test` after behavior changes
- Report deviations from plan
- If guard mode is active, respect all guard checkpoints

**Gate**: All steps complete, typecheck and tests pass.

### Phase 6: Code Review

Run `/review` on the completed changes.

- Launch all 6 parallel reviewers (pipeline, schema, adapter, daemon, simplicity, migration)
- Consolidate P1/P2/P3 findings

**Gate**: Review complete, findings presented.

### Phase 7: Resolve

If P1 or P2 findings exist, run `/resolve` to fix them.

- Fix P1s first (critical)
- Fix P2s second (important)
- Triage P3s with user
- Re-validate after fixes

**Gate**: No unresolved P1s. P2s resolved or explicitly accepted by user.

### Phase 8: Compound

Run `/compound` to capture learnings.

- Launch 4 parallel analysis agents
- Write solution doc if warranted
- Update CLAUDE.md, review agents, rules if patterns emerged
- Update plan doc status to `completed`

## Shortcuts

Not every task needs all 8 phases. Use judgment:

| Task Type | Recommended Phases |
|-----------|-------------------|
| Bug fix (known root cause) | Guard → Work → Review → Resolve → Compound |
| Small feature (clear spec) | Plan → Work → Review → Resolve → Compound |
| Roadmap phase (non-trivial) | Plan → Plan Review → Guard → Work → Review → Resolve → Compound |
| Fuzzy idea | Office Hours → Brainstorm → Plan → Plan Review → ... |
| Investigation | `/investigate` instead (separate from LFG) |

## Rules

- **Never skip planning for non-trivial work** — plans are the primary artifact
- **Gates are real** — don't auto-proceed past a gate without user input
- **P1 findings block completion** — resolve before declaring done
- **Guard mode for dangerous areas** — schema, IDs, sinks, lifecycle
- **Compound even if nothing seems worth it** — the reflection catches things
- **Report phase transitions** — tell the user when moving between phases
- **Shortcuts are fine** — use the table above, not every task is an 8-phase marathon
