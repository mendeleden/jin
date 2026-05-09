---
title: "Jin Desktop Stitch Mock Data"
status: draft
created: 2026-04-17
source:
  - ~/.config/jin/store.db
depends-on:
  - docs/jin-desktop-prd.md
  - docs/ontology.md
  - docs/execution/tasks/W4-DESKTOP-01-daemon-query-boundary.md
---

# Jin Desktop Stitch Mock Data

## Purpose

This document gives Stitch realistic sample data for Jin Desktop mockups.

It is derived from the live local SQLite store, but sanitized for external
design generation:

- exact store counts and graph shape are real
- titles/snippets are shortened or generalized
- IDs are abbreviated where possible
- projects are reduced to recognizable but non-sensitive labels

Use this document alongside [docs/jin-desktop-prd.md](/Users/edenmendel/Documents/GitHub/jin-desktop/docs/jin-desktop-prd.md:1).

---

## 1. Live Snapshot Shape

Derived from `~/.config/jin/store.db` on `2026-04-17`.

```json
{
  "overview": {
    "conversations": 1038,
    "traces": 242,
    "messages": 47737,
    "toolCalls": 18710
  },
  "conversationRelationships": {
    "root": 162,
    "spawned": 855,
    "compacted": 25
  },
  "adapters": {
    "claude-code": {
      "conversations": 922,
      "messages": 43892,
      "cost": 1072.27
    },
    "cursor": {
      "conversations": 101,
      "messages": 1837,
      "cost": 4.79
    },
    "codex": {
      "conversations": 18,
      "messages": 2549,
      "cost": 452.14
    }
  }
}
```

### Design implications

- spawned sub-agents are the dominant shape and should be visually first-class
- root conversations are the minority, so trace/tree views matter
- the product should comfortably show large traces and high tool-call density
- Claude Code dominates the current dataset, but multi-adapter activity is real

---

## 2. Home Screen Mock Data

Use this for the default "healthy / running" home state.

```json
{
  "runtimeCard": {
    "state": "running",
    "mode": "daemon",
    "uptime": "3h 42m",
    "socketPath": "~/.config/jin/jin.sock",
    "storePath": "~/.config/jin/store.db"
  },
  "activitySummary": {
    "conversations": 1038,
    "messages": 47737,
    "toolCalls": 18710,
    "traces": 242,
    "estimatedCost": 1529.20
  },
  "topAdapters": [
    { "adapter": "claude-code", "conversations": 922, "messages": 43892, "cost": 1072.27 },
    { "adapter": "cursor", "conversations": 101, "messages": 1837, "cost": 4.79 },
    { "adapter": "codex", "conversations": 18, "messages": 2549, "cost": 452.14 }
  ],
  "topTools": [
    { "tool": "Read", "calls": 6419, "conversations": 549 },
    { "tool": "Bash", "calls": 4560, "conversations": 464 },
    { "tool": "exec_command", "calls": 1508, "conversations": 15 },
    { "tool": "Grep", "calls": 1324, "conversations": 292 },
    { "tool": "Glob", "calls": 950, "conversations": 322 }
  ],
  "relationshipMix": [
    { "relationship": "spawned", "conversations": 855 },
    { "relationship": "root", "conversations": 162 },
    { "relationship": "compacted", "conversations": 25 }
  ]
}
```

### Home UX guidance

- show one big runtime card, not a tiny status chip only
- show recent conversations and top projects side-by-side
- use relationship mix to justify a trace-heavy product feel

---

## 3. Recent Conversations List

These are sanitized from recent live rows.

```json
[
  {
    "id": "conv_72ca",
    "title": "Daemon review and discovery-cache follow-up",
    "adapter": "claude-code",
    "relationship": "root",
    "project": "jin",
    "endedAt": "2026-04-17T20:40:17Z",
    "messageCount": 89,
    "toolCount": 27,
    "cost": 10.52,
    "hasChildren": true
  },
  {
    "id": "agent_f4e1",
    "title": "Focused review of adapter cache edge cases",
    "adapter": "claude-code",
    "relationship": "spawned",
    "project": "jin",
    "endedAt": "2026-04-17T20:35:41Z",
    "messageCount": 31,
    "toolCount": 14,
    "cost": 0.51,
    "hasChildren": false
  },
  {
    "id": "agent_9a7c",
    "title": "Pipeline review of daemon lifecycle behavior",
    "adapter": "claude-code",
    "relationship": "spawned",
    "project": "jin",
    "endedAt": "2026-04-17T20:33:51Z",
    "messageCount": 25,
    "toolCount": 10,
    "cost": 0.51,
    "hasChildren": false
  },
  {
    "id": "agent_24bd",
    "title": "Discovery cache migration and safety review",
    "adapter": "claude-code",
    "relationship": "spawned",
    "project": "jin",
    "endedAt": "2026-04-17T20:33:22Z",
    "messageCount": 20,
    "toolCount": 8,
    "cost": 0.36,
    "hasChildren": false
  },
  {
    "id": "conv_e0e7",
    "title": "Proposal documents and recent changes review",
    "adapter": "cursor",
    "relationship": "root",
    "project": "local / unlinked",
    "endedAt": "2026-04-17T20:31:46Z",
    "messageCount": 46,
    "toolCount": 27,
    "cost": 0.0,
    "hasChildren": false
  },
  {
    "id": "conv_81f1",
    "title": "Pull request review instructions",
    "adapter": "cursor",
    "relationship": "root",
    "project": "local / unlinked",
    "endedAt": "2026-04-17T18:51:05Z",
    "messageCount": 55,
    "toolCount": 25,
    "cost": 0.0,
    "hasChildren": false
  }
]
```

### List design guidance

- rows should visually distinguish `root`, `spawned`, and `compacted`
- spawned children should feel lighter weight but still clickable
- cost can be secondary text, not the primary visual anchor

---

## 4. Projects Screen Mock Data

Sanitized from the highest-volume projects in the live store.

```json
[
  {
    "project": "earlywarning",
    "remote": "github.com/.../earlywarning",
    "conversations": 456,
    "estimatedCost": 95.69,
    "latestActivity": "2026-03-21T05:27:07Z"
  },
  {
    "project": "jin",
    "remote": "github.com/.../jin",
    "conversations": 287,
    "estimatedCost": 1233.73,
    "latestActivity": "2026-04-17T20:40:17Z"
  },
  {
    "project": "local / unlinked",
    "remote": "",
    "conversations": 276,
    "estimatedCost": 117.07,
    "latestActivity": "2026-04-17T20:31:46Z"
  },
  {
    "project": "prismatic",
    "remote": "github.com/.../prismatic",
    "conversations": 13,
    "estimatedCost": 5.96,
    "latestActivity": "2026-03-24T22:13:42Z"
  }
]
```

### Projects UX guidance

- support projects with and without `git_remote`
- "local / unlinked" should feel like a valid state, not bad data
- latest activity is important enough to keep visible in the row

---

## 5. Search Screen Mock Data

Sample search query: `daemon`

```json
{
  "query": "daemon",
  "filters": {
    "adapter": null,
    "since": "7d"
  },
  "results": [
    {
      "conversationId": "conv_72ca",
      "conversationTitle": "Daemon review and discovery-cache follow-up",
      "project": "jin",
      "adapter": "claude-code",
      "timestamp": "2026-04-17T20:37:14Z",
      "snippet": "Diagnostics suggest the daemon is live, discovery cache is being written, and CPU pressure is coming from repeated result events."
    },
    {
      "conversationId": "conv_72ca",
      "conversationTitle": "Daemon review and discovery-cache follow-up",
      "project": "jin",
      "adapter": "claude-code",
      "timestamp": "2026-04-17T20:33:59Z",
      "snippet": "Daemon is live, cache DB exists, and runtime behavior points to discovery churn rather than transport failure."
    },
    {
      "conversationId": "agent_9a7c",
      "conversationTitle": "Pipeline review of daemon lifecycle behavior",
      "project": "jin",
      "adapter": "claude-code",
      "timestamp": "2026-04-17T20:33:51Z",
      "snippet": "Review notes focus on daemon lifecycle, shutdown coordination, and the discovery cache interaction surface."
    }
  ]
}
```

### Search UX guidance

- search results should group naturally by conversation
- each result should include project, adapter, and timestamp
- snippets should be compact, not full message bodies

---

## 6. Conversation Detail Mock Data

Use this for the detail page example.

### Conversation header

```json
{
  "id": "conv_e0e7",
  "title": "Proposal documents and recent changes review",
  "adapter": "cursor",
  "relationship": "root",
  "project": "local / unlinked",
  "traceId": "08af1e13-b9be-4279-b719-bdc29d13e0e7",
  "startedAt": "2026-04-17T18:51:36Z",
  "endedAt": "2026-04-17T20:31:46Z",
  "messageCount": 46,
  "toolCount": 27,
  "estimatedCost": 0.0
}
```

### Message timeline sample

Derived from live message order, but lightly normalized for readability.

```json
[
  {
    "role": "user",
    "turn": 0,
    "timestamp": "2026-04-17T18:51:36Z",
    "content": "Find the proposal docs, BP files, and recent changes so you can summarize the ongoing effort."
  },
  {
    "role": "assistant",
    "turn": 0,
    "timestamp": "2026-04-17T18:51:39Z",
    "content": "Searching proposal docs and blueprint files, then reviewing recent changes to summarize the current direction."
  },
  {
    "role": "assistant",
    "turn": 0,
    "timestamp": "2026-04-17T18:51:45Z",
    "content": "Collected the key design proposals and implementation notes. Next I’m comparing them to the latest code changes."
  },
  {
    "role": "assistant",
    "turn": 1,
    "timestamp": "2026-04-17T19:05:12Z",
    "content": "The proposals converge around daemon ownership, a local query boundary, and a clean future Desktop surface."
  }
]
```

### Tool call sample

```json
[
  {
    "name": "read_file_v2",
    "input": "docs/blueprint/BP-02-data-flow.md",
    "outputPreview": "Opened blueprint data-flow document and extracted the adapter -> store -> sink contract.",
    "isError": false
  },
  {
    "name": "read_file_v2",
    "input": "docs/proposals/unix-socket-daemon-boundary.md",
    "outputPreview": "Loaded daemon boundary proposal and noted the deterministic socket transport idea.",
    "isError": false
  },
  {
    "name": "ripgrep_raw_search",
    "input": "pattern: discovery-cache | path: repo root",
    "outputPreview": "Returned matching files in watch/runtime/cache surfaces.",
    "isError": false
  }
]
```

### Detail UX guidance

- timeline should feel document-like, not chat-app-like
- tool calls should be expandable inline blocks
- metadata should sit in a side panel or summary strip

---

## 7. Trace / Tree Mock Data

This is the most important differentiated surface in Jin Desktop.

The live store includes traces with:

- one root conversation
- many spawned children
- compacted continuations

### Large trace summary

Derived from a real trace with a root plus many spawned/compacted children.

```json
{
  "traceId": "trace_architecture_review",
  "conversationCount": 56,
  "relationshipMix": {
    "root": 1,
    "spawned": 49,
    "compacted": 6
  }
}
```

### Tree sample

```json
{
  "conversation": {
    "id": "root_abr",
    "title": "Ontology v2 consolidation and architecture review",
    "relationship": "root",
    "messageCount": 551,
    "toolCount": 152
  },
  "children": [
    {
      "conversation": {
        "id": "agent_s3",
        "title": "S3 sink design review",
        "relationship": "spawned",
        "messageCount": 21,
        "toolCount": 9
      },
      "children": []
    },
    {
      "conversation": {
        "id": "agent_lifecycle",
        "title": "Process lifecycle engineering panel",
        "relationship": "spawned",
        "messageCount": 30,
        "toolCount": 13
      },
      "children": []
    },
    {
      "conversation": {
        "id": "compact_01",
        "title": "Architecture review continuation",
        "relationship": "compacted",
        "messageCount": 536,
        "toolCount": 181
      },
      "children": [
        {
          "conversation": {
            "id": "compact_02",
            "title": "Architecture review continuation II",
            "relationship": "compacted",
            "messageCount": 538,
            "toolCount": 181
          },
          "children": []
        }
      ]
    }
  ]
}
```

### Trace UX guidance

- users must be able to distinguish compaction from spawning instantly
- trace view can be more graph-like
- tree view should be more hierarchy-focused
- the currently selected conversation should be obvious

---

## 8. Analytics Mock Data

### Adapter activity

```json
[
  { "adapter": "claude-code", "conversations": 922, "messages": 43892, "cost": 1072.27 },
  { "adapter": "cursor", "conversations": 101, "messages": 1837, "cost": 4.79 },
  { "adapter": "codex", "conversations": 18, "messages": 2549, "cost": 452.14 }
]
```

### Model activity

```json
[
  { "model": "claude-opus-4-6", "messages": 13085, "inputTokens": 690561, "outputTokens": 3654500 },
  { "model": "claude-haiku-4-5-20251001", "messages": 8090, "inputTokens": 312078, "outputTokens": 721865 },
  { "model": "claude-sonnet-4-5-20250929", "messages": 1771, "inputTokens": 39740, "outputTokens": 45598 },
  { "model": "claude-sonnet-4-6", "messages": 1428, "inputTokens": 101458, "outputTokens": 219466 },
  { "model": "gpt-5.4", "messages": 882, "inputTokens": 109275493, "outputTokens": 797238 }
]
```

### Tool usage

```json
[
  { "tool": "Read", "calls": 6419, "conversations": 549 },
  { "tool": "Bash", "calls": 4560, "conversations": 464 },
  { "tool": "exec_command", "calls": 1508, "conversations": 15 },
  { "tool": "Grep", "calls": 1324, "conversations": 292 },
  { "tool": "Glob", "calls": 950, "conversations": 322 },
  { "tool": "Edit", "calls": 923, "conversations": 64 }
]
```

### Analytics UX guidance

- adapter and model charts should feel secondary to conversations, not like the
  whole product
- tool usage is a strong supporting module for Home or Projects

---

## 9. Health Screen Guidance

This mock-data pack is intentionally SQLite-heavy.

For Health screen mockups, do not invent backend internals. Use the PRD and
approved daemon boundary assumptions:

- runtime state badge
- component status rows
- issue list
- sink state summary
- config/store/log/socket paths
- optional ingest progress

Health should feel operational, but it does not need exact runtime telemetry
from this document.

---

## 10. Stitch Prompt Guidance

When generating mockups, tell Stitch:

1. This is a native desktop app, not a browser dashboard.
2. Use the PRD as the product spec.
3. Use this document as realistic mock data.
4. Emphasize:
   - trace/tree visibility
   - dense conversation browsing
   - strong runtime health treatment
   - project-oriented exploration
5. Do not add:
   - chat composer UI
   - collaborative Team admin UI
   - browser-era localhost dashboard affordances
   - a second runtime concept

---

## 11. Short Prompt Block

This shorter payload can be pasted directly into a Stitch generation prompt:

```text
Use realistic Jin Desktop data derived from the live SQLite graph:

- 1,038 conversations
- 242 traces
- 47,737 messages
- 18,710 tool calls
- relationship mix: 855 spawned, 162 root, 25 compacted
- adapters: Claude Code 922 convos / Cursor 101 / Codex 18
- top projects: earlywarning 456 convos, jin 287 convos, local-unlinked 276 convos
- top tools: Read 6,419, Bash 4,560, exec_command 1,508, Grep 1,324

Show:
- a Home screen with runtime status, overview stats, recent conversations, top projects, top tools
- a Conversations screen with dense rows, filters, and relationship chips
- a Search screen using the query `daemon` with grouped results/snippets
- a Conversation Detail screen with a message timeline and inline tool calls
- a Trace view and Tree view where one root conversation fans out into many spawned children and a few compacted continuations
- a Health screen with clear running/degraded/stopped states

This is a native desktop workbench over a daemon, not a web dashboard and not a chat composer.
```
