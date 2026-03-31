---
paths:
  - "src/adapters/**/*.ts"
---

# Adapter Rules

- All adapter methods must be typed on the `Adapter` interface — never duck-type via `as any`
- Adapters are read-only data providers. They implement `findChanged(hint?)` → `ConversationRef[]` and `loadConversation(ref)` → `ConversationBundle | null`. They never write to the store.
- Adapters own their own change detection. The ingest layer has no cache.
- Conversation and message IDs must be deterministic (derived from source data). Re-ingesting the same file produces the same IDs.
- Each adapter knows its tool's compaction boundaries. Splitting logic is adapter-internal.
- Silent `catch {}` blocks are forbidden in adapters — surface parse errors so they can be debugged.
- New adapters must extract all v2 fields available in the source: `cwd`, `gitRemote`, `branch`, `model`, `traceId`, `parentId`, `relationship`.
