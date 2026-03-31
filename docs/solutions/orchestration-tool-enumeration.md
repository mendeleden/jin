---
title: Enumerate orchestration tools separately from leaf tools
tags: [adapter, investigation, methodology]
date: 2026-03-26
related: [Phase 3.3, ARCH-10]
---

# Enumerate Orchestration Tools Separately from Leaf Tools

## Problem

When investigating Cursor's state.vscdb, we found sub-agent relationships via
`composerData.subagentComposerIds` (a UUID array) and via Layer 2 directory
structure (`subagents/*.jsonl`). We documented both and considered sub-agent
detection "solved."

We missed the **spawn mechanism**: a `task_v2` tool call in the parent
session's bubble stream, with `result.agentId` linking to the child and
`params.prompt` containing the delegated task description. This was discovered
independently by a Windows counterpart who examined parent bubbles
systematically.

## Solution

When investigating any tool's data storage, separate tool calls into two
categories and enumerate both:

1. **Leaf tools** — file operations that solve user problems (read_file, grep,
   edit, run_command). These are the obvious ones.
2. **Orchestration tools** — agent management operations that create/manage
   other agents (task_v2, spawn, Task, agent_message). These live in the same
   message stream but serve a fundamentally different purpose.

For every parent→child relationship found via metadata (arrays, directory
structure, foreign keys), verify the spawn event exists in the parent's
message stream.

## Key Insight

Orchestration data lives in tool calls, not just metadata. The
`subagentComposerIds` array tells you *who* the children are. The `task_v2`
tool call tells you *when* they were spawned, *what task* was delegated,
*which model* was used, and *whether it succeeded*. Without the tool call,
you have a phone book without call records.

This applies to every multi-agent system jin tracks:
- **Cursor**: `task_v2` in parent bubbles
- **Claude Code**: `Task` tool in JSONL, subagent files in `subagents/` dir
- **Codex**: `agent_message` records, `agent_jobs` table in state_5.sqlite

## Related

- Phase 3.3 (v2-roadmap.md) — Cursor Adapter Multi-Layer Rewrite
- ARCH-10 (code-review-qa.md) — `newMessages`/`sessionForFile` duck-typed
- orchestration.md Section 2.4 — Full `task_v2` data model with verified fields

## Prevention

1. **Investigation checklist** (`docs/adapters/INVESTIGATION_CHECKLIST.md`) —
   explicit "enumerate orchestration tools" step
2. **reviewer-adapter update** — add "orchestration tool enumeration" to data
   completeness checks
3. **CLAUDE.md convention** — "separate leaf and orchestration tool calls"
4. **Test assertion** — for any session with sub-agents, assert parent message
   stream contains a spawn tool call

## Files Changed

- `docs/adapters/cursor/orchestration.md` — Added `task_v2` data model (Section 2.4)
- `docs/adapters/cursor/orchestration.md` — "Three ways to find sub-agents" (Section 2.4)
- `docs/adapters/cursor/orchestration.md` — Windows confirmation (Section 7)
