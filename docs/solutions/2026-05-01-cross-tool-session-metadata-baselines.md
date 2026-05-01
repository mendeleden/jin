---
title: Cross-tool session metadata needs a raw baseline before normalization
date: 2026-05-01
tags: [adapter, codex, claude-code, cursor, bp-04]
related: [BP-04, BP-03]
---

# Cross-tool session metadata needs a raw baseline before normalization

## Problem

Jin ingests Codex JSONL, Claude Code JSONL, and Cursor SQLite-backed sessions,
but the source-level metadata is not shaped the same way across tools.

That matters for the fields we are most likely to want across tools:

- commit identity
- repo / branch identity
- working directory and workspace roots
- continuation and compaction boundaries
- sub-agent / spawned-session lineage

Without a raw baseline, it is easy to mix together:

- metadata that exists directly in the source
- metadata that only exists on some record types
- metadata that Jin derives later from `cwd` or parent-link heuristics

## Solution

Record a simple source-of-truth summary for the three current tools.

### Codex

Raw source:

- base file: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- stable first record: `type: "session_meta"`
- later appended records: `turn_context`, `event_msg`, `response_item`,
  `compacted`

Directly available in raw data:

- session id
- session start timestamp
- `cwd`
- originator / source / cli version
- model provider
- git branch
- git remote
- git commit hash
- per-turn model
- token counts
- compaction replacement history
- sub-agent parent linkage via `forked_from_id` / structured `source`

Change pattern:

- the base `session_meta` is mostly stable
- later turns append new `turn_context` and `token_count` records
- compaction appends a `compacted` record rather than rewriting earlier data

### Claude Code

Raw source:

- base file: `~/.claude/projects/.../*.jsonl`
- subagents may live under `subagents/*.jsonl`

Directly available in raw data:

- `sessionId`
- `agentId` for child / sidechain files
- `parentUuid`
- `uuid`
- `timestamp`
- `cwd`
- `gitBranch`
- `permissionMode`
- `entrypoint`
- `origin`
- `userType`
- per-message model and token usage
- compaction boundary via `type: "system", subtype: "compact_boundary"`
- compaction summary via `type: "summary"`

Change pattern:

- the file grows by appending records
- `cwd`, `gitBranch`, and `sessionId` are repeated on many records
- compaction appends boundary + summary records
- child transcript identity may live in `agentId` while `sessionId` still
  points at the root trace

### Cursor

Raw source:

- layer 1: `state.vscdb` when present
- layer 3: `~/.cursor/chats/<workspace>/<session>/store.db`

Directly available in raw data:

- layer 1 `composerData:*`: created / updated timestamps, session name, model,
  bubble header ids, subagent ids
- layer 1 `bubbleId:*`: per-message timestamps, workspace URIs,
  workspace project dir, token counts, tool metadata
- layer 3 `meta.key = 0`: `agentId`, `latestRootBlobId`, name, created time
- layer 3 blobs: role/content/tool blocks, reasoning text, blob graph ordering

Change pattern:

- this is mutable database state rather than append-only JSONL
- `lastUpdatedAt`, bubble membership, root blob pointers, and tool state can
  change in place as the session continues
- current Cursor evidence does not expose a Codex/Claude-style explicit
  compaction event

## Key Insight

The most reusable cross-tool metadata split is:

- direct raw fields we can trust as source facts
- derived fields Jin can compute consistently after ingest

Useful direct raw fields across tools today:

- session / trace identity
- parent / spawned linkage
- timestamps
- `cwd` or workspace roots
- branch when present
- model
- token usage when present

Useful but not universally direct:

- git remote
- git commit hash

Today:

- Codex exposes branch, remote, and commit directly in raw session metadata
- Claude exposes branch directly but usually needs git resolution from `cwd`
  for remote and commit
- Cursor usually needs workspace-path resolution from layer metadata before git
  facts can be resolved

So for cross-tool normalization, the safest shared shape is:

- raw: `trace_id`, `parent_id`, `started_at`, `updated_at`, `cwd`, `branch`,
  `model`, `source_format`, `is_compacted`
- derived: `git_remote`, `git_commit`, repo identity, normalized lineage

For "directory changes", the best portable inputs are:

- Codex / Claude `cwd`
- Cursor `workspaceUris` and `workspaceProjectDir`

Those are stronger than trying to infer path changes from tool output alone.

## External Verification

This pass is not equally documented across tools.

### Strongly confirmed by public docs

- OpenAI documents `/responses/compact` as returning a compacted response with
  a special `type: "compaction"` item carrying opaque `encrypted_content`
  (`developers.openai.com/api/reference/resources/responses/methods/compact`).
- OpenAI also describes Codex as automatically using `/responses/compact` once
  `auto_compact_limit` is exceeded, and notes that mid-session working-directory
  changes are handled by inserting a new user message rather than rewriting
  earlier input (`openai.com/index/unrolling-the-codex-agent-loop/`).
- Anthropic documents stable Claude session identifiers and workspace metadata
  exposed to local integrations: `session_id`, `cwd`,
  `workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs`,
  `workspace.git_worktree`, and cumulative context-window counters
  (`code.claude.com/docs/en/statusline`).
- Anthropic documents continuation and resumption semantics in the CLI:
  `claude -c` continues the most recent conversation in the current directory,
  and `claude -r` resumes by session id or name
  (`code.claude.com/docs/en/cli-reference`).

### Confirmed locally, but not found as formal public schema docs

- Codex `session_meta`, `turn_context`, `event_msg`, and `compacted` JSONL
  envelope names
- Codex raw git metadata fields such as commit hash, branch, and repository URL
- Claude transcript record fields such as `parentUuid`, `agentId`,
  `permissionMode`, `isSidechain`, `compactMetadata`, and `summary`
- Cursor layer3 `meta.key = 0` shape with `agentId` and `latestRootBlobId`
- Cursor layer1 `composerData:*` and `bubbleId:*` key families

These remain grounded in live local files plus adapter tests and docs in this
repo, but not in a public vendor-owned storage contract that I found.

### Weakest / most empirical area

Cursor’s on-disk storage layout.

Public Cursor docs and changelog confirm the product concepts we are mapping:

- Agent is the default unified interface
- long conversations can be summarized or continued
- commit-message generation and recent-changes awareness exist as product
  features

But the storage internals are not described in official docs I found. The best
public confirmation I found is a Cursor staff forum reply stating:

- transcripts live under `~/.cursor/projects/<project>/agent-transcripts/`
- chat metadata lives in `state.vscdb`
- there is no server copy

That is useful evidence, but it is still weaker than a formal schema doc.

## Canonical Recommendation

Jin’s current canonical conversation contract in `src/contracts/conversations.ts`
is close to the right boundary already:

- `id`
- `traceId`
- `parentId`
- `relationship`
- `forkPoint`
- `name`
- `cwd`
- `gitRemote`
- `branch`
- `model`
- `startedAt`
- `endedAt`
- `sourcePath`
- `sourceFormat`

The main question is not "add lots more fields." It is "which fields deserve to
be first-class instead of living in adapter-local metadata or derivation."

### Promote or keep canonical

These are stable enough across multiple tools to justify first-class support.

- `traceId`
  Already canonical. This is the strongest shared identity across compaction
  and spawned-session boundaries.
- `parentId`
  Already canonical. This is required for compaction chains and spawned trees.
- `relationship`
  Already canonical. Multiple sources express continuation and delegation,
  even if they do so differently.
- `forkPoint`
  Already canonical. It is not always known, but it is a useful shared slot for
  spawn/fork attachment when the source exposes it.
- `cwd`
  Keep canonical. It is the best portable directory/workspace anchor for Codex
  and Claude, and a reasonable normalized target for Cursor workspace paths.
- `branch`
  Keep canonical. Codex and Claude expose it directly often enough, and Cursor
  can derive it once a workspace path is resolved.
- `model`
  Keep canonical. All three tools expose model identity somewhere in source or
  session metadata.
- `startedAt` / `endedAt`
  Keep canonical. All three tools expose enough timing information to populate
  these, even if Cursor layer3 sometimes needs interpolation from mutable state.
- `sourceFormat`
  Keep canonical. It explains important downstream behavior differences between
  append-only JSONL and mutable SQLite-backed sources.

### Keep derived, not raw-canonical

These are useful enough to keep in the normalized conversation, but they should
be treated as derived or opportunistic rather than universal raw truth.

- `gitRemote`
  Keep canonical as a derived field, not as a required raw-source field.
  Codex often has it directly. Claude and Cursor often require git resolution
  from `cwd` / workspace path.
- `gitCommit`
  Do not promote into the core contract yet, but if Jin wants commit-level
  identity later, treat it the same way as `gitRemote`: optional and derived
  unless a source provides it directly.

### Strong candidates for a future additive field

These are the only fields from this pass that look worth promoting if Jin wants
to extend the contract later.

- `projectDir`
  Reason: Claude distinguishes `cwd` from `workspace.project_dir`, and Cursor
  may expose a stable workspace root separately from per-message working paths.
  This is a better long-lived project identity anchor than `cwd` alone when the
  session changes directories.
- `gitCommit`
  Reason: useful for correlating sessions to exact repo state, especially for
  post-hoc analysis of edits and commit-message generation. But today it is too
  asymmetric across tools to require in the core model.

### Leave adapter-local for now

These fields are real, but too source-specific to promote into the shared
conversation contract today.

- `permissionMode` / approval mode
  Useful operational context, but not central to trace identity.
- `originator`, `entrypoint`, `source`
  Useful provenance, but too vendor-specific.
- `workspace.added_dirs`
  Real for Claude, but not yet cross-tool.
- `agentId`
  Important inside Claude raw parsing, but it is a source-local identity used to
  derive the canonical conversation `id`, not a canonical field itself.
- `compactMetadata`
  Useful as a compaction artifact, but it belongs in messages or adapter-local
  metadata, not on the conversation row.
- Cursor `latestRootBlobId`
  Storage-internal, not ontology-level.

### Recent changes and commit awareness

Two tempting fields should stay out of the core contract for now:

- `recent_changes`
- `commit_message`

Reason:

- Cursor publicly advertises recent-changes awareness and commit-message
  generation as product features, but not as stable storage fields.
- Codex and Claude can often infer recent changes from tool calls, diffs, or
  git state, but that is workflow behavior, not a portable source field.

If Jin wants those later, they should probably be materialized as:

- derived analytics
- exported artifacts
- optional trace summaries

not as first-class conversation columns.

### Directory-change recommendation

If the goal is to understand movement within and across repos, use a two-level
model:

- canonical `cwd`: current or best-known working directory for the conversation
- optional future `projectDir`: stable launch/workspace root when the source
  exposes it

This lets Jin distinguish:

- "the session belongs to repo X"
- "the agent moved into subdirectory Y during the session"

without overloading one field.

### Bottom line

If Jin changes the contract at all, the highest-value additive field is
`projectDir`.

If Jin does not want contract churn, the best move is:

- keep the current canonical model
- continue deriving `gitRemote`
- keep commit identity, recent changes, and source-specific session controls in
  adapter-local metadata or higher-level analytics

## Prevention

- keep adapter notes explicit about which metadata is raw versus derived
- avoid treating git remote or commit as universally raw fields
- validate continuation and compaction on live data, not just fixtures, because
  append-only JSONL and mutable SQLite stores drift in different ways
- when adding new cross-tool fields, first document where each source gets the
  value: direct raw field, repeated per-record hint, or post-ingest derivation

## Related

- `BP-04` adapter contract
- `BP-03` conversation and relationship semantics

## Files Changed

- `docs/solutions/2026-05-01-cross-tool-session-metadata-baselines.md`

## Reproduction

Representative commands used during the audit:

```bash
# Codex: inspect the opening metadata envelope
sed -n '1,40p' ~/.codex/sessions/2026/05/01/rollout-2026-05-01T09-36-14-019de2e5-5a37-7b63-91c4-e97e4e4ad06a.jsonl

# Codex: inspect later appended records
tail -n 40 ~/.codex/sessions/2026/05/01/rollout-2026-05-01T09-36-14-019de2e5-5a37-7b63-91c4-e97e4e4ad06a.jsonl

# Claude: inspect a root transcript
sed -n '1,40p' ~/.claude/projects/-home-edmininode/f54306f4-0632-4833-83da-37251a44bf9f.jsonl

# Claude: find compaction and child-session evidence
rg -n 'compact_boundary|summary|"agentId"|isSidechain' ~/.claude/projects -g '*.jsonl'

# Cursor layer 3: inspect session meta
sqlite3 ~/.cursor/chats/<workspace>/<session>/store.db "select hex(value) from meta where key='0';"

# Cursor layer 1, when present: inspect composer metadata
sqlite3 <state.vscdb> "select key, value from cursorDiskKV where key like 'composerData:%' limit 5;"
sqlite3 <state.vscdb> "select key, value from cursorDiskKV where key like 'bubbleId:%' limit 5;"
```

Public references used in the verification pass:

- OpenAI Responses compaction API:
  `https://developers.openai.com/api/reference/resources/responses/methods/compact`
- OpenAI Codex agent-loop article:
  `https://openai.com/index/unrolling-the-codex-agent-loop/`
- Anthropic Claude Code statusline docs:
  `https://code.claude.com/docs/en/statusline`
- Anthropic Claude Code CLI reference:
  `https://code.claude.com/docs/en/cli-reference`
- Cursor changelog:
  `https://www.cursor.com/en/changelog/agent-is-ready-and-ui-refresh`
- Cursor staff forum reply on local storage:
  `https://forum.cursor.com/t/chat-history-gone-after-pc-restart-agent-transcripts-files-emptied-how-to-recover/158251/5`
