---
title: Cursor live layer3 needs pointer-root decoding and conversation-scoped ids
date: 2026-04-09
tags: [adapter, cursor, bp-04, bp-10]
related: [W3-ADAPTER-10, W3-VALIDATE-01, BP-04, BP-10]
---

# Cursor live layer3 needs pointer-root decoding and conversation-scoped ids

## Problem

The live Cursor validation in `W3-VALIDATE-01` showed `6` discovered refs,
`0` loaded bundles, and `6` null bundles on the real local dataset.

The adapter assumed layer3 worked like a JSON message chain:

- `meta.latestRootBlobId` points at a JSON row
- that JSON row has `parentId`
- walking `parentId` reconstructs the conversation

The real dataset did not match that assumption. The root blobs were binary
pointer nodes that referenced ordered message blobs instead of being messages
themselves. Once those roots were decoded, a second live-only issue surfaced:
Cursor layer3 blob ids are content-addressed, so identical messages can reuse
the same blob id in different conversations.

## Solution

The adapter-local fix did two things:

1. load each layer3 blob as raw bytes plus JSON when available, then recursively
   expand non-JSON pointer blobs by following embedded 32-byte blob refs in
   order
2. namespace emitted layer3 message ids and tool-call ids with the conversation
   id so content-addressed blob reuse cannot collide in the local store

The same change also stitches separate `role: "tool"` result rows back onto the
earlier assistant tool call when both rows share a `toolCallId`.

## Key Insight

For adapter work on content-addressed stores, raw blob ids are storage ids, not
safe ontology ids.

Two guardrails follow from that:

- binary pointer/index blobs must be decoded as ordering structures, not
  dropped as malformed messages
- emitted entity ids must be scoped by the conversation trace when the backing
  storage can reuse content hashes across sessions

## Prevention

- keep fixture tests that mimic live pointer roots instead of only testing
  JSON-parent chains
- when an adapter reads content-addressed storage, add a regression test that
  loads two conversations with reused source ids and proves the emitted ids are
  still unique
- use the disposable-store live validation harness before declaring adapter
  confidence, because `findChanged()` plus `loadConversation()` alone would have
  missed the store-level collision class

## Related

- `W3-ADAPTER-10`
- `W3-VALIDATE-01`
- `BP-04` adapter contract
- `BP-10` release validation

## Files Changed

- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md`
