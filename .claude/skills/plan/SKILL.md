---
name: plan
description: Create an implementation plan for a Jin feature or phase. Researches codebase, references roadmap, and produces a detailed plan document.
argument-hint: "[feature or phase description]"
---

# Plan: $ARGUMENTS

Create a detailed implementation plan for the work described above.

## Process

### 1. Research (use subagents in parallel)

Launch parallel research to understand the current state:

- **Codebase research**: Read all files that will be affected. Understand current implementation, callers, callees, tests.
- **Review findings**: Check `docs/review/` for any bugs, architecture issues, or design decisions related to this work.
- **Roadmap context**: Check `docs/v2-roadmap.md` for where this work fits in the phased plan.
- **Ontology compliance**: Check `docs/ontology.md` to ensure alignment with v2 data model.

### 2. Design

Based on research, design the approach:

- What files need to be created, modified, or deleted?
- What's the dependency order? (Which changes must happen first?)
- What are the risks? What could go wrong?
- What alternatives were considered and rejected?

### 3. Write Plan

Save the plan to `docs/plans/` with this format:

```markdown
---
title: [Plan title]
phase: [Roadmap phase if applicable]
status: draft
created: [ISO date]
---

# [Title]

## Context
[Why this work is needed — link to review findings, roadmap phase, or user request]

## Approach
[High-level strategy in 2-3 sentences]

## Files to Change

### Create
- `path/to/new/file.ts` — [purpose]

### Modify
- `path/to/existing.ts` — [what changes and why]

### Delete
- `path/to/dead-code.ts` — [why it's safe to delete]

## Implementation Sequence
1. [First step — what and why]
2. [Second step — depends on #1 because...]
3. ...

## Risks & Mitigations
- **Risk**: [what could go wrong]
  **Mitigation**: [how to prevent or recover]

## Validation
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes
- [ ] [Domain-specific checks]

## Open Questions
- [Anything that needs user input before proceeding]
```

### 4. Present for Approval

Show the plan summary and ask for approval before any implementation begins. Plans are the primary artifact — get alignment here, not during coding.
