# Cursor Adapter

**Adapter ID:** `cursor`
**Module:** `src/adapters/cursor.ts`
**Current source:** Layer 3 only (`~/.cursor/chats/<hash>/<session>/store.db`)
**Status:** Partial — 1 of 4 storage layers ingested

---

## Storage Layers

| # | Name | Path | Format | Tokens | Tool Results | Timestamps | Sub-agents | Used by Adapter |
|---|------|------|--------|--------|-------------|------------|------------|-----------------|
| 1 | IDE Sessions | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | SQLite KV (`cursorDiskKV`) | Yes | Yes | Yes (per-msg) | Yes (IDs) | No |
| 2 | Agent Transcripts | `~/.cursor/projects/<proj>/agent-transcripts/<uuid>/<uuid>.jsonl` | JSONL | No | No (inputs only) | No | Yes (files) | No |
| 3 | CLI Blob Store | `~/.cursor/chats/<hash>/<session>/store.db` | SQLite (blob tree) | No | Yes (in blobs) | No (interpolated) | No | **Yes** |
| 4 | AI Tracking | `~/.cursor/ai-tracking/ai-code-tracking.db` | SQLite | No | N/A | Yes | No | No |

**Key insight:** Layer 1 (`state.vscdb`) is the richest source with tokens,
tool details, timestamps, and sub-agent links. Layer 3 (what the adapter
currently reads) is CLI-only and lacks tokens entirely.

**Critical finding:** CLI agent sessions (`cursor agent --print`) do NOT
appear in Layer 1 — only IDE sessions do. Both IDE and CLI sessions create
Layer 2 transcripts.

## Coverage Gaps

Mapping to [ontology.md Section 4](../../ontology.md) capabilities:

| Capability | Available In | Adapter Status |
|-----------|-------------|---------------|
| Token counts (`input`, `output`) | Layer 1 (`bubbleId.tokenCount`) | Not captured — adapter returns 0 |
| Tool call names + inputs | Layer 1 (`toolFormerData`), Layer 2 (`tool_use` blocks) | Not captured |
| Tool call results/output | Layer 1 (`toolFormerData`), Layer 3 (blobs) | Not captured |
| Per-message timestamps | Layer 1 (`bubbleId.createdAt`) | Not captured — interpolated from file mtime |
| Sub-agent relationships | Layer 1 (`subagentComposerIds`), Layer 2 (`subagents/` dir) | Not captured |
| Thinking/reasoning | Layer 3 (reasoning blocks in blobs) | Not captured |
| Model name | Layer 1 (`modelConfig.modelName`) | Not captured |
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
- `src/adapters/cursor.ts` — Current adapter implementation (reads Layer 3 only)
- `src/adapters/types.ts` — `Adapter`, `Session`, `Message`, `ToolUse` interfaces
