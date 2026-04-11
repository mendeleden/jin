# Cursor Adapter

**Adapter ID:** `cursor`
**Module:** `src/adapters/cursor.ts`
**Current source:** Layer 1 + Layer 3
**Status:** Partial — 2 of 4 storage layers ingested

---

## Storage Layers

| # | Name | Path | Format | Tokens | Tool Results | Timestamps | Sub-agents | Used by Adapter |
|---|------|------|--------|--------|-------------|------------|------------|-----------------|
| 1 | IDE Sessions | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | SQLite KV (`cursorDiskKV`) | Yes (model-dependent) | Partial (`toolFormerData.result` / `additionalData`) | Yes (per-msg) | Yes | **Yes** |
| 2 | Agent Transcripts | `~/.cursor/projects/<proj>/agent-transcripts/<uuid>/<uuid>.jsonl` | JSONL | No | No (inputs only) | No | Yes (files) | No |
| 3 | CLI Blob Store | `~/.cursor/chats/<hash>/<session>/store.db` | SQLite (blob tree) | No | Yes (blob-linked) | No (interpolated) | No | **Yes** |
| 4 | AI Tracking | `~/.cursor/ai-tracking/ai-code-tracking.db` | SQLite | No | N/A | Yes | No | No |

**Key insight:** Layer 1 (`state.vscdb`) is the richest IDE source with
timestamps, model names, tool metadata, workspace paths, and sub-agent links.
Layer 3 (`store.db`) is the CLI source and carries reasoning text plus
blob-linked tool results, but not tokens.

**Critical finding:** CLI agent sessions (`cursor agent --print`) do NOT
appear in Layer 1 — only IDE sessions do. Both IDE and CLI sessions create
Layer 2 transcripts.

## Coverage Gaps

Mapping to [ontology.md Section 4](../../ontology.md) capabilities:

| Capability | Available In | Adapter Status |
|-----------|-------------|---------------|
| Token counts (`input`, `output`) | Layer 1 (`bubbleId.tokenCount`) | Captured for Layer 1; Layer 3 still returns 0 because `store.db` does not expose token counts |
| Tool call names + inputs | Layer 1 (`toolFormerData`), Layer 3 (`tool-call` / `tool_use` blocks) | Captured |
| Tool call results/output | Layer 1 (`toolFormerData.result` / `additionalData`), Layer 3 (`tool-result` blobs) | Captured, but Layer 1 is only as rich as Cursor's stored `toolFormerData` payload |
| Per-message timestamps | Layer 1 (`bubbleId.createdAt`) | Captured for Layer 1; Layer 3 still interpolates from file metadata |
| Sub-agent relationships | Layer 1 (`subagentComposerIds`, `task_v2` bubbles), Layer 2 (`subagents/` dir) | Captured for Layer 1 only |
| Thinking/reasoning | Layer 3 reasoning blocks, Layer 1 `thinking` / `allThinkingBlocks` when text exists | Layer 3 captured; Layer 1 now surfaces text when present, but current local data is mostly empty signatures |
| Model name | Layer 1 (`modelConfig.modelName`), Layer 3 blob payloads | Captured when present |
| DAG (parent message ID) | Layer 3 (blob `parentId` chain) | Partial (used for tree traversal, not exposed) |

## Files in This Directory

| File | Contents |
|------|----------|
| [overview.md](./overview.md) | Storage architecture, data models, layer relationships, recommended strategy |
| [investigation.md](./investigation.md) | Reproducible forensics log — how we found this, commands to run |
| [examples.md](./examples.md) | Real data samples, SQL queries, stream-json events, normalized jin output |
| [orchestration.md](./orchestration.md) | Programmatic interfaces (ACP, CLI, AppleScript), traceability experiment, layer coverage by interface |

## Cross-References

- [ontology.md Section 4](../../ontology.md) — Adapter Capability Matrix (Cursor column)
- [ontology.md Section 6.3](../../ontology.md) — Cursor Mapping Table
- `src/adapters/cursor.ts` — Current adapter implementation (Layer 1 IDE + Layer 3 CLI)
- `src/adapters/types.ts` — `Adapter`, `ParsedConversation`, `ParsedMessage`, `ParsedToolCall` interfaces (see [BP-04](../../blueprint/BP-04-adapter-contract.md))
