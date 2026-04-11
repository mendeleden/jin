---
name: review
description: Run parallel Jin-specific code reviewers on recent changes. Launches 5 domain reviewers simultaneously.
argument-hint: "[file, PR, or description of changes to review]"
---

# Review: $ARGUMENTS

Run 5 Jin-specific reviewers in parallel on the changes described above.

## Process

### 1. Identify Changes

Determine what to review:
- If a file path is given, review that file and its callers/callees
- If "PR" or a branch is mentioned, run `git diff main...HEAD` to get the full diff
- If no specific target, run `git diff` for unstaged + `git diff --cached` for staged changes
- If nothing is changed, ask what to review

### 2. Launch Parallel Reviewers

Spawn all 6 reviewer agents simultaneously using the Agent tool:

| Agent | Domain | What It Checks |
|-------|--------|----------------|
| `reviewer-pipeline` | Data pipeline | Backpressure, change detection, delivery guarantees, resource budgets |
| `reviewer-schema` | Schema integrity | Type↔DDL sync, migration safety, upsert correctness, Postgres contract |
| `reviewer-adapter` | Adapter correctness | Parsing accuracy, data completeness, ID stability, edge cases |
| `reviewer-daemon` | Daemon lifecycle | PID management, signal handling, service integration, shutdown |
| `reviewer-simplicity` | Code simplicity | Dead code, over-engineering, YAGNI, readability |
| `reviewer-migration` | Migration safety | ID determinism, data preservation, re-ingest correctness, rollback |

Each agent receives:
- The list of changed files
- The diff content
- Instructions to review from their specific lens

### 3. Consolidate Results

After all agents return, consolidate into a single report:

```markdown
## Review Summary

### P1 — Critical (must fix before merge)
- [finding] — [reviewer] — file:line

### P2 — Important (should fix)
- [finding] — [reviewer] — file:line

### P3 — Nice to fix
- [finding] — [reviewer] — file:line

### Consensus
| Area | Pipeline | Schema | Adapter | Daemon | Simplicity |
|------|----------|--------|---------|--------|------------|
| [area] | [verdict] | [verdict] | [verdict] | [verdict] | [verdict] |

### Disagreements
[Where reviewers differed — these are the most valuable signals]
```

### 4. Action Items

List concrete next steps, ordered by priority. If P1 issues exist, they must be resolved before proceeding.
