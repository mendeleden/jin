# W3-ADAPTER-12 Cursor Tool Stitching And Layer1 Metadata Follow-up

## Scope

- packet: `W3-ADAPTER-12`
- date: `2026-04-10`
- owned surface:
  - `src/adapters/cursor.ts`
  - `test/cursor-adapter.test.ts`
  - `docs/adapters/cursor/index.md`
  - `docs/adapters/cursor/orchestration.md`
  - `docs/ontology.md`

## Goal

Verify whether the post-approval Cursor bug report was still real on the current
tree and local dataset, then close the confirmed adapter-local/data-doc issues
without widening into runtime, sink, or contract work.

## Exact Commands

### Focused adapter tests

```sh
bun test test/cursor-adapter.test.ts
```

Observed:

- `12` tests passed
- `0` failures
- new deterministic coverage now includes:
  - repeated same-name Layer 3 tool results matched by `toolCallId`
  - cross-message late tool-result routing that must search older messages by
    `toolCallId` before any fallback
  - Layer 3 naming that skips synthetic Cursor prelude / rules wrappers
  - preserving user-authored wrapper-like tags when they are not a leading
    synthetic prelude envelope
  - Layer 1 `cwd` from `workspaceUris`
  - Layer 1 `thinkingContent` from raw bubble fields

### Live source count check

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = await adapter.findChanged({ kind: "startup-scan" }); console.log(JSON.stringify({ total: refs.length, layer1: refs.filter((ref) => ref.sourcePath.endsWith("state.vscdb")).length, layer3: refs.filter((ref) => ref.sourcePath.endsWith("/store.db")).length }, null, 2));'
```

Observed:

- `96` total refs
- `90` Layer 1 refs
- `6` Layer 3 refs

### Live Layer 3 naming probe

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = await adapter.findChanged({ kind: "startup-scan" }); const layer3 = refs.filter((ref) => ref.sourcePath.endsWith("/store.db")); const rows = []; for (const ref of layer3) { const bundle = await adapter.loadConversation(ref); rows.push({ id: ref.id, name: bundle?.conversation.name }); } console.log(JSON.stringify(rows, null, 2));'
```

Observed after the fix:

- all `6` Layer 3 conversation names are now prompt-derived
- sampled names no longer start with synthetic prelude wrappers like
  `<user_info>` or `<rules>`
- representative names now include:
  - `Read the file src/config.ts and tell me the default port number...`
  - `Say hello in exactly one sentence. Do not use any tools.`
  - `I need you to do a thorough analysis. Find all adapter files...`

### Live repeated same-name tool-result probe

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = (await adapter.findChanged({ kind: "startup-scan" })).filter((ref) => ref.sourcePath.endsWith("/store.db")); let duplicateNamedMessages = 0; let duplicateNamedTools = 0; let duplicateNamedWithoutOutput = 0; for (const ref of refs) { const bundle = await adapter.loadConversation(ref); for (const message of bundle?.messages ?? []) { const byName = new Map(); for (const tool of message.toolUses) { const list = byName.get(tool.name) ?? []; list.push(tool); byName.set(tool.name, list); } for (const list of byName.values()) { if (list.length > 1) { duplicateNamedMessages += 1; duplicateNamedTools += list.length; duplicateNamedWithoutOutput += list.filter((tool) => tool.output.length === 0).length; } } } } console.log(JSON.stringify({ layer3Conversations: refs.length, duplicateNamedMessages, duplicateNamedTools, duplicateNamedWithoutOutput }, null, 2));'
```

Observed after the fix:

- `6` Layer 3 conversations loaded
- `20` messages still contain repeated same-name tools
- `58` repeated same-name tool calls were observed
- `0` of those repeated same-name tool calls had empty outputs

Representative previously-bad local session now loads correctly:

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = await adapter.findChanged({ kind: "startup-scan" }); const ref = refs.find((item) => item.id === "3c29dee7-efd4-46d1-984d-abad992f016a"); const bundle = ref ? await adapter.loadConversation(ref) : null; const rows = bundle?.messages.flatMap((message) => { const grouped = new Map(); for (const tool of message.toolUses) { const list = grouped.get(tool.name) ?? []; list.push({ id: tool.id, outputLength: tool.output.length }); grouped.set(tool.name, list); } return Array.from(grouped.entries()).filter(([, tools]) => tools.length > 1).map(([name, tools]) => ({ messageId: message.id, name, tools })); }) ?? []; console.log(JSON.stringify(rows, null, 2));'
```

Observed:

- session `3c29dee7-efd4-46d1-984d-abad992f016a` still contains one message with
  `12` repeated `Read` tool calls
- after the fix, all `12` now carry non-empty outputs
  - output lengths: `4171`, `1372`, `25797`, `8508`, `14041`, `6753`, `6259`,
    `5183`, `5489`, `6948`, `5638`, `5643`

### Live Layer 1 cwd / thinking probe

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = (await adapter.findChanged({ kind: "startup-scan" })).filter((ref) => ref.sourcePath.endsWith("state.vscdb")); let conversationsWithCwd = 0; let messagesWithThinking = 0; for (const ref of refs) { const bundle = await adapter.loadConversation(ref); if (bundle?.conversation.cwd) conversationsWithCwd += 1; for (const message of bundle?.messages ?? []) { if (message.thinkingContent) messagesWithThinking += 1; } } console.log(JSON.stringify({ layer1Conversations: refs.length, conversationsWithCwd, messagesWithThinking }, null, 2));'
```

Observed:

- `90` Layer 1 conversations loaded
- `15` conversations now surface non-empty `cwd`
- `140` Layer 1 messages now surface non-empty `thinkingContent`

Representative thinking sample:

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter(); const refs = (await adapter.findChanged({ kind: "startup-scan" })).filter((ref) => ref.sourcePath.endsWith("state.vscdb")); for (const ref of refs) { const bundle = await adapter.loadConversation(ref); const message = bundle?.messages.find((item) => item.thinkingContent.length > 0); if (message) { console.log(JSON.stringify({ conversationId: ref.id, messageId: message.id, thinkingPreview: message.thinkingContent.slice(0, 200) }, null, 2)); break; } }'
```

Observed:

- first sampled thinking-bearing message came from conversation
  `088cf592-38fc-47d5-bb7d-8b544f35e569`
- preview:
  - `**Compiling markdown summary**`
  - `I'm compiling a markdown summary with file:line citations...`

## Findings

### 1. P0 repeated same-name Layer 3 tool-result stitching

Status: `confirmed and fixed`

- The bug report was real on the current code path.
- There were two copies of the same faulty matching pattern:
  - inline tool-result stitching inside `extractLayer3Content()`
  - later cross-message stitching inside `findLayer3ToolUse()`
- Both paths previously mixed exact-ID and name fallback in a single reverse
  walk, which allowed repeated same-name tool results to collapse onto the last
  matching tool use.
- The fix now uses two-pass matching:
  - first scan all candidate tool uses by exact `toolCallId`
  - only if none match, fall back by tool name

### 2. Layer 1 cwd extraction

Status: `confirmed and fixed`

- The bug report was directionally correct but slightly misplaced.
- On the current local dataset, stable workspace paths are present on Layer 1
  bubble rows via `workspaceUris[0]`, not on `composerData`.
- The adapter now prefers decoded `file://` URIs from Layer 1 bubbles before
  falling back to generic path keys.
- `workspaceProjectDir` is only used as a lower-confidence fallback.

### 3. Layer 1 thinking extraction

Status: `confirmed and fixed`

- The raw Layer 1 type omission was real.
- Current local data shows both:
  - `thinking` objects on assistant bubbles
  - `thinkingDurationMs`
- `allThinkingBlocks` remains empty on current local data, but `thinking.text`
  is populated often enough to matter in practice.
- The adapter now maps:
  - `allThinkingBlocks[]` text first when present
  - otherwise `thinking.text`

### 4. Layer 3 fallback naming

Status: `confirmed and fixed`

- The report was real on the current local CLI dataset.
- Before the fix, Layer 3 fallback naming used the first non-empty user message,
  which was often just Cursor's synthetic envelope:
  - `<user_info>...</user_info>`
  - `<git_status>...</git_status>`
  - `<agent_transcripts>...</agent_transcripts>`
  - `<agent_skills>...</agent_skills>`
  - `<rules>...</rules>`
- The adapter now strips only a leading synthetic envelope and then unwraps a
  leading `<user_query>...</user_query>` payload when present.
- It no longer removes wrapper-like blocks globally from arbitrary user text.

### 5. Cursor docs / ontology drift

Status: `confirmed and fixed`

- `docs/adapters/cursor/index.md` was still teaching a Layer 3-only adapter.
- `docs/ontology.md` still described Cursor as if Layer 1 was merely
  "available but not captured."
- `docs/adapters/cursor/orchestration.md` still claimed tool results were not
  captured and thinking blocks were categorically absent.
- All three docs were refreshed to match the current adapter surface.

## Residual Gaps

These were not part of this packet and remain unchanged:

- Layer 2 agent-transcript JSONL support is still not implemented
- `gitRemote` / `branch` are still empty
- Layer 3 token counts are still unavailable from `store.db`
- many Layer 1 conversations still legitimately have no surfaced `cwd`

## Completion Report

Completed:
- fixed repeated same-name Layer 3 tool-result stitching in both inline and
  cross-message paths
- fixed cross-message fallback ordering so `toolCallId` search runs across all
  messages before any name/global fallback
- fixed Layer 1 `cwd` extraction to prefer decoded `workspaceUris`
- fixed Layer 1 `thinkingContent` extraction from current raw bubble fields
- fixed Layer 3 fallback naming to skip only leading synthetic envelopes while
  preserving user-authored wrapper-like text
- refreshed stale Cursor doc surfaces and ontology references
- added focused regression coverage plus live local-data validation

Files changed:
- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `docs/adapters/cursor/index.md`
- `docs/adapters/cursor/orchestration.md`
- `docs/ontology.md`

Tests run:
- `bun test test/cursor-adapter.test.ts`
- live local-data probes listed above

BP acceptance matrix:
- Layer 3 tool-result stitching no longer loses outputs when multiple same-name tools exist in one session and distinct `toolCallId`s are present -> implemented in `src/adapters/cursor.ts`, tested by `test/cursor-adapter.test.ts`, validated on live session `3c29dee7-efd4-46d1-984d-abad992f016a`
- Layer 1 `cwd` and thinking fields reflect the richest stable raw source already present in Cursor's current local data without changing frozen output contracts -> implemented in `src/adapters/cursor.ts`, tested by `test/cursor-adapter.test.ts`, validated by the live Layer 1 cwd / thinking probes above
- Layer 3 conversation naming skips synthetic Cursor session prelude text when choosing a fallback title so live sessions are named from user-authored prompts -> implemented in `src/adapters/cursor.ts`, tested by `test/cursor-adapter.test.ts`, validated by the live Layer 3 naming probe above
- Packet-owned Cursor docs and ontology references stop claiming the adapter is Layer 3-only or that tool results are categorically not captured when the current code/data proves otherwise -> implemented in `docs/adapters/cursor/index.md`, `docs/adapters/cursor/orchestration.md`, and `docs/ontology.md`, validated by this audit

V1 comparison:
- parity improved versus the older Layer 3-only / underdecoded behavior; no
  prior v1 surface intentionally justified dropping these fields

Risks / follow-ups:
- if Cursor introduces additional synthetic envelope tags, naming cleanup may
  need a small follow-up
- Layer 2 support remains the next major correctness gap once runtime work
  allows more adapter follow-up time

Blocked / needs Codex:
- none inside packet scope
