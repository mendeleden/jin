---
title: "Add projectDir to the canonical conversation model"
status: proposed
created: 2026-05-01
relates-to: [BP-03, BP-04, BP-05, BP-08]
---

# Add projectDir to the canonical conversation model

## Summary

This proposal adds one new optional canonical field to the conversation model:

- `projectDir`

Meaning:

- stable project or workspace root for the conversation, when the source can
  expose it directly or Jin can derive it with high confidence

This is intentionally distinct from:

- `cwd` = best-known working directory at a point in the session

The goal is to preserve a clean distinction between:

- where the session belongs
- where the agent happened to be working at a given moment

## Why This Is Worth Adding

Current `cwd` is doing too much.

Across tools:

- Codex may change working directory mid-session
- Claude publicly distinguishes `cwd` from `workspace.project_dir`
- Cursor can expose workspace roots separately from per-message working paths

That creates two different semantics that are currently being compressed into
one field:

1. session-level project root
2. current or last-known working directory

`projectDir` gives Jin a stable home for the first concept without weakening
`cwd`.

## Design

### Proposed field

```ts
projectDir: string; // Stable project/workspace root. Empty if unknown.
```

### Population rules

- Use direct source data when available.
- If the source clearly exposes a project root distinct from `cwd`, populate
  `projectDir` with that root.
- If the source only exposes one stable directory-like field, adapters MAY set
  `projectDir = cwd`.
- If the source does not expose enough information, leave `projectDir = ""`.

### Important constraint

`projectDir` is optional and additive.

This proposal does **not**:

- remove `cwd`
- redefine trace or parent semantics
- require every adapter to know a project root
- require git resolution to succeed

## Recommendation

Adopt `projectDir` as:

- canonical
- optional
- additive

Keep `cwd` as the best-known working directory and continue treating
`gitRemote` as derived/opportunistic.

## Exact Proposed Diffs

These are proposal diffs only. They are not applied to the frozen blueprint in
this change.

### 1. `src/contracts/conversations.ts`

```diff
 interface ParsedConversation {
   id: string;
   traceId: string;
   parentId: string;
   relationship: ConversationRelationship;
   forkPoint: number;
   adapterId: string;
   name: string;
   cwd: string;
+  projectDir: string;
   gitRemote: string;
   branch: string;
   model: string;
   startedAt: string;
   endedAt: string;
   sourcePath: string;
   sourceFormat: ConversationSourceFormat;
 }
```

Recommended comment:

```diff
-  cwd: string;
+  cwd: string;         // Best-known working directory for the conversation
+  projectDir: string;  // Stable project/workspace root (empty if unknown)
```

### 2. `docs/blueprint/BP-04-adapter-contract.md`

#### 2a. Git resolution section

Current BP-04 says git is resolved from `cwd`.

Proposed replacement:

```diff
-### 5. Git Resolution
-
-The adapter resolves `git_remote` and `branch` from the conversation's
-`cwd` during `loadConversation()`.
+### 5. Git Resolution
+
+The adapter resolves `git_remote` and `branch` from the conversation's
+best repository anchor during `loadConversation()`.
+
+Preferred order:
+
+1. `projectDir` when non-empty
+2. `cwd` as fallback
 
 ```typescript
-// Per unique cwd, run once and cache within the adapter instance
-function resolveGit(cwd: string): { remote: string; branch: string } {
-  const remote = execSync("git remote get-url origin", { cwd }).trim();
-  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd }).trim();
+// Per unique repo anchor, run once and cache within the adapter instance
+function resolveGit(dir: string): { remote: string; branch: string } {
+  const remote = execSync("git remote get-url origin", { cwd: dir }).trim();
+  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir }).trim();
   return { remote, branch };
 }
 ```
 
-**Performance:** Many conversations share the same `cwd`. The adapter
-caches git results by `cwd` within the adapter instance, reducing
-hundreds of subprocess spawns to a handful of unique lookups.
+**Performance:** Many conversations share the same `projectDir` or `cwd`.
+The adapter caches git results by the chosen repo anchor within the adapter
+instance, reducing hundreds of subprocess spawns to a handful of unique
+lookups.
 
 **Non-git directories:** `git_remote` = empty string, `branch` = empty
-string. The conversation's `cwd` becomes the fallback grouping key for
-routing.
+string. `projectDir` or `cwd` remains the fallback grouping key for routing.
```

#### 2b. ParsedConversation shape

```diff
 interface ParsedConversation {
   id: string;                    // Deterministic from source
   traceId: string;               // Groups related conversations. Root: traceId = id
   parentId: string;              // Who created this. Empty for roots.
   relationship: 'root' | 'compacted' | 'spawned' | 'forked';
   forkPoint: number;             // Turn in parent that triggered this. -1 if unknown.
   adapterId: string;             // "claude-code", "codex", "cursor", etc.
   name: string;                  // From first user message or tool-specific title
-  cwd: string;                   // Working directory
+  cwd: string;                   // Best-known working directory
+  projectDir: string;            // Stable project/workspace root (empty if unknown)
   gitRemote: string;             // git remote get-url origin (empty if non-git)
   branch: string;                // git branch (empty if non-git or unknown)
   model: string;                 // Primary model (most frequent across messages)
   startedAt: string;             // ISO 8601
   endedAt: string;               // ISO 8601
   sourcePath: string;            // Absolute path to primary source file
   sourceFormat: 'jsonl' | 'sqlite' | 'json';
 }
```

#### 2c. Minimum viable adapter example

```diff
   async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
     // Parse the source file for this conversation
     // Return: { conversation: {...}, messages: [...] }
     // Defaults: traceId = id, parentId = "", relationship = "root"
-    //           gitRemote = "", branch = "", forkPoint = -1
+    //           projectDir = "", gitRemote = "", branch = "", forkPoint = -1
     // Return null if the source no longer exists
   }
```

### 3. `docs/blueprint/BP-03-conversation-model.md`

BP-03 is mostly about lineage, so the diff should stay small and only clarify
the directory semantics.

Recommended insertion near the trace/model discussion or invariants:

```diff
+## Directory Semantics
+
+The conversation model carries two directory fields with different meanings:
+
+- `project_dir`: stable project/workspace root for the conversation when known
+- `cwd`: best-known working directory for the conversation
+
+Why both are needed:
+
+- a session can begin in one project root and later `cd` into nested paths
+- some tools expose both the launch/workspace root and the current working
+  directory
+- grouping, routing, and repo identity are more stable at the project-root
+  level than at the current-directory level
+
+When `project_dir` is unknown, it is empty and `cwd` remains the fallback
+directory anchor.
```

Optional addition to the model examples:

```diff
 interface ParsedConversation {
   ...
   name: string;
   cwd: string;
+  projectDir: string;
   gitRemote: string;
   branch: string;
   ...
 }
```

## Adapter Mapping Guidance

If accepted, the initial adapter guidance should be:

### Codex

- `projectDir`
  Start with `session_meta.cwd` as the default project root.
- `cwd`
  Continue updating from later `turn_context.cwd` when it changes.

This is the biggest immediate win: Codex can preserve both the session root and
the later working directory if the agent moves.

### Claude Code

- `projectDir`
  Prefer `workspace.project_dir` when available from documented runtime
  surfaces; otherwise fall back to the earliest stable transcript `cwd`.
- `cwd`
  Keep the best-known working directory from transcript records.

### Cursor

- `projectDir`
  Prefer `workspaceProjectDir` or decoded workspace-root signals when present.
- `cwd`
  Keep the best-known current directory derived from workspace URIs or adjacent
  metadata.

## Spillover Beyond BP-03 / BP-04

If this proposal were accepted, it would also require follow-up outside the
requested diff surface.

### BP-05 / store schema

Conversation storage would need a new column:

```diff
 CREATE TABLE conversations (
   id TEXT PRIMARY KEY,
   trace_id TEXT NOT NULL,
   parent_id TEXT DEFAULT '',
   relationship TEXT NOT NULL,
   fork_point INTEGER DEFAULT -1,
   adapter_id TEXT NOT NULL,
   name TEXT NOT NULL,
   cwd TEXT DEFAULT '',
+  project_dir TEXT DEFAULT '',
   git_remote TEXT DEFAULT '',
   branch TEXT DEFAULT '',
   ...
 );
```

### Runtime / grouping guidance

Any doc that currently says "group or route by `cwd` when git is absent" should
be softened to:

- prefer `projectDir`
- fall back to `cwd`

That is probably a `BP-08` follow-up, not part of the minimal proposal.

## Compatibility

This is a safe additive change if implemented carefully:

- existing adapters can emit `projectDir = ""`
- existing consumers can ignore the new field
- git resolution can continue using `cwd` until each adapter is upgraded

## Risks

The main risk is fake precision.

If adapters populate `projectDir` too aggressively, Jin could encode a
directory root that the source never really asserted. The rule should stay
strict:

- populate when directly known
- otherwise leave empty
- only use `cwd` as `projectDir` when the source has no better distinction

## Bottom Line

`projectDir` is the smallest contract change that materially improves
cross-tool directory semantics without destabilizing the lineage model.

If adopted, the minimal authoritative edits are:

1. add `projectDir` to `ParsedConversation`
2. update BP-04 git-resolution language to prefer `projectDir` over `cwd`
3. add a short BP-03 clarification that `cwd` and `projectDir` are different
   concepts
