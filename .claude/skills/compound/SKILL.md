---
name: compound
description: Capture learnings from solved problems into searchable solutions. Runs parallel analysis agents, then consolidates. Updates CLAUDE.md and review agents if patterns were discovered.
argument-hint: "[description of what was solved]"
---

# Compound: $ARGUMENTS

Capture what was learned from the work just completed so future sessions benefit.

## Process

### 1. Parallel Analysis

Launch 4 analysis passes simultaneously using the Agent tool. Each agent receives the description of what was solved plus access to read the changed files and docs.

**Agent 1 — Context Analyzer**
> Analyze the problem that was solved. What was the root cause? What made it hard to find or fix? What was the scope of the blast radius? Read the changed files and summarize the problem in 3-5 sentences. Reference specific file:line locations.

**Agent 2 — Solution Extractor**
> Extract the solution approach. Not the code — the *thinking*. What alternatives were considered? What was the key decision that made the solution work? Would this approach apply to similar problems in Jin (other adapters, other sinks, other lifecycle code)? Be specific about what's reusable vs what's one-off.

**Agent 3 — Related Docs Finder**
> Search `docs/review/` (bugs.md, architecture.md, dead-code.md, design-decisions.md), `docs/solutions/`, `docs/v2-roadmap.md`, and `docs/ontology.md` for related findings. Does this solution close any open BUG-*, ARCH-*, or DEAD-* items? Does it advance a roadmap phase? List all connections with their IDs.

**Agent 4 — Prevention Strategist**
> How do we prevent this class of problem from recurring? Options: unit test, integration test, type constraint, lint rule, review agent update, CLAUDE.md convention, rules file addition. Be specific — name the test file, the rule, or the agent. If the review agents should have caught this, identify which one and what to add to its "Known Issues" section.

### 2. Consolidate

After all 4 agents return, decide:

- **Worth compounding?** If the work was a trivial fix with no reusable insight, report "Nothing worth compounding" and stop.
- **Solution doc?** If there's a reusable insight, write it to `docs/solutions/`.
- **CLAUDE.md update?** Only for durable patterns — not every bug fix.
- **Agent update?** If a reviewer should have caught this.

### 3. Write Solution (if warranted)

Save to `docs/solutions/` with YAML frontmatter:

```markdown
---
title: [Descriptive title]
tags: [adapter, schema, pipeline, daemon, sink, routing, config, migration]
date: [ISO date]
related: [review IDs like BUG-1, ARCH-12, or roadmap phase]
---

# [Title]

## Problem
[From Context Analyzer output]

## Solution
[From Solution Extractor output]

## Key Insight
[The non-obvious thing — the reason this doc exists]

## Related
[From Related Docs Finder output — linked review items, roadmap phases]

## Prevention
[From Prevention Strategist output — specific tests, rules, or agent updates]

## Files Changed
- `path/to/file.ts` — [what changed]
```

### 4. Update Systems (if warranted)

Based on Prevention Strategist output:

- **CLAUDE.md**: Add new conventions or known issues for durable patterns only
- **Review agents**: Add to the relevant agent's "Known Issues" or "Your Lens" section
- **Rules files**: Add path-scoped rules if a convention applies to specific directories

### 5. Summary

Report what was compounded:

```
## Compound Summary

- Solution saved: [path or "no — straightforward fix"]
- CLAUDE.md updated: [section or "no"]
- Reviewer updated: [agent name + what was added, or "no"]
- Rules updated: [file or "no"]
- Review items closed: [BUG-1, ARCH-12, etc. or "none"]
- Roadmap advanced: [phase or "no"]
```
