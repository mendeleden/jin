---
name: work
description: Execute an approved plan with step-by-step progress tracking and validation after each change. Use after /plan approval.
argument-hint: "[plan name or path to plan doc]"
---

# Work: $ARGUMENTS

Implement an approved plan with discipline — one step at a time, validated at each stage.

## Process

### 1. Load the Plan

Find the plan in `docs/plans/`. If a name is given, match it. If a path is given, read it directly.

Verify:
- Plan exists and has `status: draft` or `status: approved`
- Plan has an implementation sequence with numbered steps
- If no plan exists, stop and say: "No plan found. Run `/plan` first."

### 2. Create Task List

Convert the plan's implementation sequence into tasks. Each step becomes a tracked task.

Use TaskCreate for each step. This gives the user visibility into progress.

### 3. Execute Step by Step

For each step in the implementation sequence:

**Before starting:**
- Mark the task as `in_progress`
- Read all files that will be affected
- Understand the current state before changing it

**During:**
- Make the changes described in the plan
- If the plan needs to change, update `docs/plans/[plan].md` and note what changed and why
- Don't silently deviate from the plan

**After each step:**
- Run `bun run typecheck` if TypeScript files were changed
- Run `bun test` if behavior was changed
- Mark the task as `completed` only if validation passes
- If validation fails, fix the issue before moving to the next step

### 4. Deviation Protocol

If you discover something the plan didn't account for:

1. **Minor** (typo in plan, file was already renamed): Fix it, note in the plan doc
2. **Medium** (need to change an extra file, different function signature): Update the plan doc, continue
3. **Major** (approach doesn't work, discovered a blocker): Stop. Report what you found. Ask the user whether to revise the plan or proceed differently.

Never silently change the approach on a major deviation.

### 5. Final Validation

After all steps are complete:

```bash
bun run typecheck    # must pass
bun test             # must pass
```

If both pass, update the plan doc status from `draft`/`approved` to `implemented`.

If tests fail, fix the failures before declaring done. If you can't fix them, report what's failing and why.

### 6. Handoff

Report:
- Steps completed: N/N
- Files changed: [list]
- Tests: passing / failing (which ones)
- Deviations from plan: [list, if any]
- Ready for `/review`: yes / no (and why not if no)
