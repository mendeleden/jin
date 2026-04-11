# W3-ADAPTER-07 Claude Code Live Hardening Validation — 2026-04-08

**Packet:** `W3-ADAPTER-07`
**Scope:** `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`

## Commands Run

### 1. Focused packet-local tests

```bash
bun test test/claude-code-reference-adapter.test.ts
```

Outcome:

- `12` tests passed.
- Coverage now includes:
  - empty preferred path with populated fallback on `darwin` and `linux`
  - competing populated paths on `darwin` and `linux`
  - Windows `%APPDATA%` path precedence and legacy fallback
  - explicit `projectsDir` override precedence
  - real Claude child-file shape where `sessionId` stays on the root trace and `agentId` identifies the child conversation

### 2. Default-path selection on the live machine

```bash
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; const adapter = new ClaudeCodeAdapter(); const watchPaths = adapter.watchPaths(); const refs = await adapter.findChanged({ kind: "startup-scan" }); console.log(JSON.stringify({ watchPaths, refCount: refs.length, firstRef: refs[0] ?? null, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));'
```

Observed:

- `watchPaths` resolved to `/Users/edenmendel/.claude/projects`
- `refCount` was `916`
- the adapter no longer required a manual `dataDir` override to see the real dataset

### 3. Previously failing live child transcript

```bash
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; const sourcePath = `${process.env.HOME}/.claude/projects/-Users-edenmendel-Documents-GitHub-auth-alternative/d65d46fd-312e-40d7-81a5-ca9c7e38695f/subagents/agent-a0f0efcc85ce04488.jsonl`; const adapter = new ClaudeCodeAdapter(); const refs = await adapter.findChanged({ kind: "startup-scan" }); const ref = refs.find((candidate) => candidate.sourcePath === sourcePath); if (!ref) throw new Error("target ref not found"); const bundle = await adapter.loadConversation(ref); console.log(JSON.stringify({ watchPaths: adapter.watchPaths(), ref, conversation: bundle?.conversation ?? null, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));'
```

Observed:

- default path still resolved to `/Users/edenmendel/.claude/projects`
- the ref ID is now the child `agentId` (`a0f0efcc85ce04488`), not the root `sessionId`
- `loadConversation()` completed without `Maximum call stack size exceeded`
- the returned conversation preserved the live relationship fields:
  - `id: a0f0efcc85ce04488`
  - `traceId: d65d46fd-312e-40d7-81a5-ca9c7e38695f`
  - `parentId: d65d46fd-312e-40d7-81a5-ca9c7e38695f`
  - `relationship: spawned`

### 4. Full live dataset load probe

```bash
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; const adapter = new ClaudeCodeAdapter(); const refs = await adapter.findChanged({ kind: "startup-scan" }); let maxRss = process.memoryUsage().rss; let loaded = 0; for (const ref of refs) { const bundle = await adapter.loadConversation(ref); if (!bundle) throw new Error(`missing bundle for ${ref.id}`); loaded += 1; const rss = process.memoryUsage().rss; if (rss > maxRss) maxRss = rss; if (loaded % 100 === 0) console.log(JSON.stringify({ loaded, rssMb: Math.round(rss / 1024 / 1024), maxRssMb: Math.round(maxRss / 1024 / 1024) })); } console.log(JSON.stringify({ loaded, maxRssMb: Math.round(maxRss / 1024 / 1024), finalRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }));'
```

Observed:

- all `916` refs loaded successfully
- the prior stack overflow did not recur
- peak RSS reached `812 MB`
- final RSS was `812 MB`

## Interpretation

### Path-selection result

The default Claude adapter path-selection bug is fixed in this lane:

- the live machine now resolves to `/Users/edenmendel/.claude/projects` without a config override
- focused tests cover empty-preferred/populated-fallback, competing populated paths, and explicit override precedence

### Stack-overflow result

The live stack overflow was adapter-local and is fixed here:

- real Claude child transcripts can keep the root `sessionId` while the child conversation identity lives in `agentId`
- the adapter now indexes child transcripts by `agentId`
- parent lookup no longer resolves a child transcript back to itself
- missing root transcript files degrade to a spawned-link fallback instead of recursive reload

### RSS result

The adapter-local hardening reduced the live worst case from the previously reported multi-GB runaway to a bounded but still too-large single-source peak:

- the JSONL scanner no longer builds multi-array `ParsedRecord[]` pipelines
- discovery/load now stream record handling file-by-file and avoid the recursive reload path
- despite that, a full-bundle materialization of the largest live Claude sources still pushes RSS well above the `256 MB` BP-02 hard limit

This is therefore **not fully closed adapter-side**. Under the frozen `ConversationBundle` contract, a single large Claude transcript still has to be materialized in memory as one full bundle. Further reduction to the BP-02 hard limit likely needs a broader design change outside this packet boundary, such as:

- a contract-approved bounded representation for very large tool-result content
- or a pipeline/store change that can ingest a large source without holding the full normalized bundle in memory at once

## Platform Path Review

- `macOS`: prefer `~/.config/claude/projects` when it contains Claude JSONL data; otherwise fall back to `~/.claude/projects`
- `Linux`: same as macOS, with the same populated-source precedence rule
- `Windows`: prefer `%APPDATA%\\Claude\\projects`, then fall back to `%USERPROFILE%\\.claude\\projects`, then keep `%USERPROFILE%\\.config\\claude\\projects` as a compatibility fallback

## Boundary Note

No pipeline, sink, or contract files were changed in this lane. The remaining RSS-over-budget condition is documented here as a non-adapter blocker because the next safe step appears to require a frozen-contract decision rather than another local adapter tweak.
