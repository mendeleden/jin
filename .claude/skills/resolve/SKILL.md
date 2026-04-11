---
name: resolve
description: Auto-fix review findings from /review. Processes P1 (critical) first, then P2 (important). Re-validates after each fix.
argument-hint: "[optional: specific finding IDs to resolve]"
---

# Resolve Review Findings

Systematically fix findings from the last `/review` run.

## Process

### 1. Gather Findings

Look for the most recent review output in the conversation. If specific finding IDs are provided in the arguments, resolve only those.

Categorize:
- **P1 (critical)**: Must fix. Process these first.
- **P2 (important)**: Should fix. Process after all P1s are resolved.
- **P3 (nice-to-fix)**: Present to user for go/no-go. Don't auto-fix.

### 2. Triage P3s

Before fixing anything, present P3 findings to the user:

```
### P3 Findings — Approve or Skip?

1. [finding] — [file:line] — Fix? (y/n)
2. [finding] — [file:line] — Fix? (y/n)
```

Wait for user response before including P3s in the fix queue.

### 3. Fix P1s (Sequential)

For each P1 finding:

1. Read the file and surrounding context
2. Understand why the reviewer flagged it
3. Implement the fix
4. Run `bun run typecheck`
5. Run `bun test`
6. If validation fails, fix the regression before moving on
7. Report: "P1 resolved: [description] — [file:line]"

P1s are sequential because each fix may affect subsequent findings.

### 4. Fix P2s

Same process as P1, but after all P1s are resolved.

If a P2 fix conflicts with a P1 fix, flag it and ask the user.

### 5. Fix Approved P3s

Same process. These are lowest priority.

### 6. Re-Review

After all fixes are applied, run a lightweight check:

```bash
bun run typecheck
bun test
```

If you changed significant logic, suggest running `/review` again to verify no new issues were introduced.

### 7. Report

```markdown
## Resolve Summary

### Fixed
- [P1] [description] — [file:line]
- [P2] [description] — [file:line]

### Skipped (user declined)
- [P3] [description] — reason

### Introduced
- [Any new issues discovered during fixing]

### Validation
- typecheck: pass/fail
- tests: pass/fail (N passed, M failed)
```
