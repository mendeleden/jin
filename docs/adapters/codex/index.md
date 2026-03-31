# Codex Adapter

**Adapter ID:** `codex`
**Module:** `src/adapters/codex.ts`
**Current source:** Layer 2 only (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`)
**Status:** Partial — 1 of 7 storage layers ingested, critical data gaps in token/model/context parsing

---

## Storage Layers

| # | Name | Path | Format | Tokens | Tool Results | Timestamps | Sub-agents | Used by Adapter |
|---|------|------|--------|--------|-------------|------------|------------|-----------------|
| 1 | Thread DB | `~/.codex/state_5.sqlite` | SQLite (threads, logs, jobs) | Yes (cumulative) | No | Yes (epoch) | No | **No** |
| 2 | Session Rollouts | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL (RolloutLine envelope) | Yes (per-turn + cumulative) | Yes | Yes (ISO 8601) | No | **Yes** (partial) |
| 3 | Session Index | `~/.codex/session_index.jsonl` | JSONL | No | No | Yes | No | **No** |
| 4 | Automation DB | `~/.codex/sqlite/codex-dev.db` | SQLite (automations, inbox) | No | No | Yes | No | **No** |
| 5 | Global State | `~/.codex/.codex-global-state.json` | JSON | No | No | No | No | **No** |
| 6 | Shell Snapshots | `~/.codex/shell_snapshots/<thread-id>.sh` | Shell script | No | No | No | No | **No** |
| 7 | Archived Sessions | `~/.codex/archived_sessions/` | JSONL | Same as Layer 2 | Same as Layer 2 | Same as Layer 2 | Same as Layer 2 | **No** |

**Key insight:** Unlike Cursor (which splits storage across 4 incompatible layers
depending on interface), Codex CLI and Desktop write to the **same two stores**
(Layer 1 + Layer 2) with identical record formats. The only difference is
`source=exec` vs `source=vscode` in the threads table.

**Critical finding:** The current adapter reads Layer 2 JSONL but misses
`token_count`, `turn_context`, and `reasoning` record types entirely. Layer 1
(`state_5.sqlite`) contains cumulative token counts, git metadata, and thread
lifecycle data that the adapter ignores.

## Coverage Gaps

Mapping to [ontology.md Section 4](../../ontology.md) capabilities:

| Capability | Available In | Adapter Status |
|-----------|-------------|---------------|
| Token counts (input, output, cached, reasoning) | Layer 2 (`token_count` events), Layer 1 (`threads.tokens_used`) | **Not captured** — adapter misses `token_count` event type |
| Tool call names + inputs (CLI) | Layer 2 (`function_call` response_item) | Captured via `function_call` type |
| Tool call results/output (CLI) | Layer 2 (`function_call_output` response_item) | Captured via `function_call_output` type |
| Tool call names + inputs (Desktop) | Layer 2 (`custom_tool_call` response_item) | **Not captured** — different schema from CLI `function_call` |
| Tool call results/output (Desktop) | Layer 2 (`custom_tool_call_output` response_item) | **Not captured** — JSON output with `exit_code`, `duration_seconds` |
| Per-message timestamps | Layer 2 (`timestamp` on every RolloutLine) | Partially captured |
| Model name + reasoning effort | Layer 2 (`turn_context` records) | **Not captured** |
| Thinking/reasoning | Layer 2 (`reasoning` response_item) | **Not capturable** — content is encrypted |
| Git branch/remote | Layer 1 (`threads.git_branch`, `threads.git_origin_url`) | **Not captured** |
| Rate limits | Layer 2 (`token_count.rate_limits`) | **Not captured** |
| Session source (CLI vs Desktop) | Layer 1 (`threads.source`) | **Not captured** |
| Sandbox policy + approval mode | Layer 2 (`turn_context.sandbox_policy`) | **Not captured** |
| Compaction handling | Layer 2 (`compacted` record with `replacement_history`) | **Not captured** — type is `compacted`, not `compaction` |
| Turn interruption | Layer 2 (`event_msg:turn_aborted`) | **Not captured** |
| Message phase metadata | Layer 2 (`phase` field on post-compaction messages) | **Not captured** |
| Sub-agent linkage | Layer 2 (`session_meta.source.subagent` + `forked_from_id`) | **Not captured** — sub-agent JSONL files exist but not correlated to parent |
| Sub-agent spawn/wait | Layer 2 (`spawn_agent`/`wait_agent` function_calls in parent) | **Not captured** — parent-side spawn records provide agent_id + nickname |
| Web search | Layer 2 (`web_search_call` response_item) | **Not captured** — new tool call type |

## Files in This Directory

| File | Contents |
|------|----------|
| [overview.md](./overview.md) | Storage architecture, data models, layer relationships, recommended strategy |
| [investigation.md](./investigation.md) | Reproducible forensics log — how we found this, commands to run |
| [examples.md](./examples.md) | Real data samples, SQL queries, JSONL events, normalized jin output |
| [orchestration.md](./orchestration.md) | Programmatic interfaces (exec, resume, SDK, MCP), traceability experiment |

## Cross-References

- [ontology.md Section 4](../../ontology.md) — Adapter Capability Matrix (Codex column)
- `src/adapters/codex.ts` — Current adapter implementation (reads Layer 2 only)
- `src/adapters/types.ts` — `Adapter`, `Session`, `Message`, `ToolUse` interfaces
- `tools/codex-trace-session.ts` — Automated trace experiment driver
