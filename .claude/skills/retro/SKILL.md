---
name: retro
description: Periodic reflection across recent work. Scans git history, solution docs, review findings, and roadmap progress to surface meta-patterns and update the system.
argument-hint: "[optional: time range like '1 week' or 'since last retro']"
---

# Retro: $ARGUMENTS

Step back from the code and look at the big picture. What happened, what did we learn, and what should change?

## Process

### 1. Gather Data (parallel)

Launch parallel research to collect recent activity:

**Git history**
```bash
git log --oneline --since="1 week ago"   # or specified range
git diff --stat HEAD~20                    # scope of recent changes
```

**Solutions produced**
- Read `docs/solutions/` — what problems were solved recently?

**Review findings**
- Read `docs/review/` — which BUG-*, ARCH-*, DEAD-* items have been closed vs remain open?

**Roadmap progress**
- Read `docs/v2-roadmap.md` — which phase checkboxes were completed? What moved forward?

**Plans**
- Read `docs/plans/` — which plans were completed, which are still in progress, which were abandoned?

### 2. Velocity Check

Summarize what shipped:

```
## What Shipped
- [feature/fix] — [1-line description]
- [feature/fix] — [1-line description]

## What Didn't Ship (planned but incomplete)
- [item] — [why: blocked, deprioritized, harder than expected]

## Roadmap Progress
- Phase [N]: [X/Y checkboxes complete] — [on track / behind / ahead]
```

### 3. Pattern Analysis

Look across the recent work for meta-patterns:

**What kept coming up?**
- Same files touched repeatedly? (Might need a deeper refactor)
- Same type of bug found multiple times? (Might need a systemic fix)
- Same review finding across different PRs? (Might need a rule or convention)

**What was harder than expected?**
- Any task that took 3x longer than planned? Why?
- Any plan that had to be revised mid-implementation? What was missed?

**What was easier than expected?**
- Any task that went smoother than anticipated? Can we replicate that?

**What did we learn?**
- New understanding of an adapter's storage format?
- New constraint discovered (Postgres, Prismatic, service managers)?
- New convention that emerged organically?

### 4. System Health Check

Evaluate the compound engineering setup itself:

- **CLAUDE.md**: Still accurate? Any conventions that should be added or removed?
- **Review agents**: Did they catch what they should have? Did they miss anything that should be added to their lens?
- **Rules files**: Any new path-scoped conventions needed?
- **Solutions dir**: Are solution docs actually useful for reference, or just noise?
- **Plans dir**: Are plans the right granularity? Too detailed? Too vague?

### 5. Action Items

Produce concrete next steps:

```
## Retro Actions

### System Updates
- [ ] Update CLAUDE.md: [specific change]
- [ ] Update reviewer agent: [which one, what to add]
- [ ] New rule needed: [path scope, convention]

### Process Changes
- [ ] [Change to how we work — e.g., "always run /review before merging adapter changes"]

### Technical Debt
- [ ] [Debt identified that should be scheduled — reference roadmap phase]

### Next Focus
- [ ] [What to prioritize in the next period]
```

### 6. Save

Save to `docs/brainstorms/retro-[date].md`:

```markdown
---
title: "Retro: [date range]"
date: [ISO date]
type: retro
---

[Full retro content]
```

### 7. Execute System Updates

If the retro identified CLAUDE.md updates, agent updates, or rule changes — make them now. Don't defer system maintenance.
