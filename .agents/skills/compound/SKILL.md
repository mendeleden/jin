---
name: compound
description: Use when the user wants to capture durable learnings from completed work, codify a reusable solution, update repo guidance, or "compound" knowledge after a non-trivial fix, feature, or review.
---

# Compound

Capture reusable lessons from recently completed work so future Codex sessions start smarter.

## Scope

Infer the scope from the user's description plus the current diff, staged changes, or the most recent relevant commit. Read only the changed files and the smallest set of nearby docs needed to understand the lesson.

## Stop Early

If the change is trivial, one-off, or offers no reusable insight, report `Nothing worth compounding` with one short reason and stop.

## Workflow

### 1. Establish What Changed

- Identify the work under consideration from the prompt, `git diff`, staged changes, or a recent commit.
- Read the touched files plus any directly related docs.
- When relevant, check for linked context in `.execution/`, `docs/blueprint/`, `docs/adapters/`, `docs/execution/tasks/`, `CLAUDE.md`, and `AGENTS.md`.

### 2. Extract Four Outputs

Produce these four outputs before deciding whether to write anything:

- **Problem**: what failed, drifted, or was hard to reason about
- **Solution**: what changed and why this approach worked
- **Reusable insight**: what generalizes to future Jin work
- **Prevention**: what should catch this earlier next time

### 3. Analyze In Parallel When Available

If subagents are available and useful, split the analysis into up to four independent passes:

- context and root cause
- solution and reusable pattern
- related docs, review IDs, packets, and blueprint links
- prevention via tests, types, docs, or review guidance

If subagents are not available, do the same analysis sequentially.

### 4. Decide Whether To Compound

Only write artifacts for durable lessons. Prefer no artifact over a noisy artifact.

Good candidates:

- a bug class likely to recur in other adapters, sinks, or lifecycle code
- a review finding that exposed a missing guardrail
- a design decision that future work needs to reuse
- a workflow lesson that should become repo guidance

Weak candidates:

- typo fixes
- local refactors with no reusable pattern
- changes whose value is obvious from the diff alone

### 5. Write A Solution Note When Warranted

If the lesson is durable, create `docs/solutions/` if needed and write:

- `docs/solutions/YYYY-MM-DD-short-slug.md`

Use this structure:

```md
---
title: Short descriptive title
date: YYYY-MM-DD
tags: [adapter, schema, pipeline, daemon, sink, routing, config, migration]
related: [BUG-1, ARCH-12, W3-RUNTIME-01]
---

# Title

## Problem

## Solution

## Key Insight

## Prevention

## Related

## Files Changed
```

Keep the note tight. The `Key Insight` section should justify why the document exists.

### 6. Update Repo Guidance Only When Durable

If the lesson should change future behavior, make the smallest relevant update to:

- `AGENTS.md` for Codex-wide repo guidance
- `.agents/skills/...` when a reusable Codex workflow should change
- `CLAUDE.md` only if the repository keeps Claude guidance in parallel and the rule should stay aligned

Do not add guidance for one-off quirks.

### 7. Report The Result

End with a short summary that states:

- whether anything was worth compounding
- whether a solution note was written
- whether repo guidance changed
- any related review IDs or blueprint items that were closed or clarified
