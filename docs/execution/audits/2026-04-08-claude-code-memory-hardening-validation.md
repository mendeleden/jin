# Claude Code Memory Hardening Validation — 2026-04-08

**Packet:** `W3-ADAPTER-06`
**Scope:** `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`

## Measurement Path

The representative validation uses the adapter's packet-local cache boundary as
the measurement target:

1. Build a multi-file Claude Code fixture with one parent session, one spawned
   child session, and three extra root sessions.
2. Run `findChanged({ kind: "startup-scan" })` across all five files.
3. Inspect the adapter's private caches after discovery:
   - `fileIndexCache` must contain one entry per discovered source
   - each cache entry must retain only `sessionId` plus `ConversationRef[]`
   - discovery cache entries must not retain `FileModel` / `bundles`
   - `loadedFileCache` must still be empty before any load
4. Load refs from two source files and confirm the full-model cache stays
   bounded to the most recently loaded source path.

## Why This Closes The W3-ADAPTER-05 Follow-On

`W3-ADAPTER-05` identified one specific hazard: Claude Code discovery retained
full `ConversationBundle[]` values in a multi-file cache and `loadConversation()`
reused those retained bundles. That exact path is removed here.

After this packet:

- discovery caches only lightweight per-file ref indexes
- full bundles are materialized in `loadConversation()` via a one-source cache
- loading a second source replaces the previous full-model cache entry

This validation is packet-local because it proves the retained state boundary
directly in the Claude Code adapter without relying on pipeline RSS behavior or
analogy to other adapters.
