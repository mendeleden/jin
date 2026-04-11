---
name: brainstorm
description: Clarify fuzzy requirements through guided questioning before planning. Use when the task is ambiguous, has multiple possible approaches, or touches undecided design questions.
argument-hint: "[idea, question, or rough requirement]"
---

# Brainstorm: $ARGUMENTS

Explore the problem space before committing to a plan. Surface hidden constraints, competing approaches, and open questions.

## Process

### 1. Understand the Ask

Restate what you think the user wants in 2-3 sentences. Ask: "Is this right, or am I missing something?"

Don't proceed until alignment is confirmed.

### 2. Map the Problem Space

Research in parallel:

- **Codebase state**: What exists today that's relevant? Read the files, not just the docs.
- **Review findings**: Check `docs/review/` — has this area been flagged? Any BUG-*, ARCH-*, or DEC-* items?
- **Roadmap position**: Check `docs/v2-roadmap.md` — where does this fit? Is there a phase that already covers this?
- **Prior solutions**: Check `docs/solutions/` — has a related problem been solved before?
- **Ontology constraints**: Check `docs/ontology.md` — does the v2 data model impose any decisions?

### 3. Surface Tensions

Identify competing concerns. Jin commonly has tensions between:

- **Adapter generality vs tool-specific correctness** (e.g., should all adapters share change detection logic, or each own theirs?)
- **Simplicity vs completeness** (e.g., extract all available fields vs only what's needed now?)
- **Local-first vs push-first** (e.g., optimize SQLite query performance vs sink delivery speed?)
- **CLI ergonomics vs daemon reliability** (e.g., simple `jin start` vs robust lifecycle management?)

Name the tensions explicitly. Don't resolve them — present them.

### 4. Propose Approaches

For each viable approach:

```
### Approach A: [Name]
- **How**: [2-3 sentences]
- **Pros**: [bullet list]
- **Cons**: [bullet list]
- **Risk**: [what could go wrong]
- **Effort**: [small / medium / large]
```

Aim for 2-4 approaches. Include a "do nothing" option if the status quo is viable.

### 5. Open Questions

List questions that need answers before a plan can be written:

- [ ] [Question that affects the approach]
- [ ] [Question about scope or constraints]
- [ ] [Question about dependencies or ordering]

### 6. Save Output

Save to `docs/brainstorms/` with this format:

```markdown
---
title: [Descriptive title]
date: [ISO date]
status: exploring | decided
decision: [which approach was chosen, filled in after discussion]
---

[brainstorm content]
```

### 7. Ask for Direction

Present the approaches and open questions. Wait for the user to choose before proceeding to `/plan`.

Never auto-select an approach. The brainstorm is input for human judgment, not a decision engine.
