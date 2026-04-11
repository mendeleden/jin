---
title: "BP-03: Conversation Model"
status: reviewed
created: 2026-03-28
depends-on: [BP-01, BP-04]
informs: [BP-05, BP-08]
---

# BP-03: Conversation Model

## Principle

**Everything is a Conversation.** A compacted continuation is a Conversation.
A sub-agent is a Conversation. A fork is a Conversation. There is no separate
"segment" or "sub-session" entity — just Conversations linked by three
columns.

This means the store has one table for all conversations, one table for all
messages, one table for all tool calls. Relationships are expressed through
data, not through schema hierarchy.

---

## The Three Linking Columns

Every Conversation carries three columns that define its place in a tree:

| Column | Type | Purpose |
|--------|------|---------|
| `trace_id` | string | Groups all related conversations into one trace. For root conversations, `trace_id = id`. |
| `parent_id` | string | Points to the conversation that created this one. Empty for roots. |
| `relationship` | enum | How this conversation relates to its parent: `root`, `compacted`, `spawned`, `forked`. |

These three columns replace v1's `is_sub_agent`, `parent_session_id`, and
`is_compacted` booleans. The booleans could only express "yes/no" — the
new model expresses "what kind of relationship and to whom."

### Why Three Columns, Not One

`parent_id` alone gives you a tree, but querying "all conversations in this
trace" requires a recursive CTE — one round-trip per level of depth. For a
conversation that was compacted 5 times with 3 sub-agents each, that's 15+
recursive steps.

`trace_id` flattens this: `WHERE trace_id = ?` returns every related
conversation in one indexed scan, regardless of depth. It's denormalized
for query performance.

**trace_id is recomputable.** The normalized truth is the `parent_id` graph.
`trace_id` is a denormalization derived from it: walk parent_id to the root,
that root's id is the trace_id for every node in the tree. If trace_id is
ever wrong (adapter bug, partial ingest), re-ingesting the source files
corrects it — deterministic IDs + replace semantics recompute the full tree.

`relationship` tells you *why* two conversations are linked, not just *that*
they are. This matters for display (compaction boundaries are visual
separators; sub-agents are collapsible trees) and for analytics (cost of
sub-agents vs cost of the root conversation).

---

## Relationship Types

### root

The original conversation. No parent, no predecessor.

```
trace_id  = self
parent_id = ""
```

Every trace has exactly one root. The root's `id` is typically the
`trace_id` for the entire tree.

### compacted

A continuation after context compaction. The tool summarized prior history
to free context window space, and the conversation continues in a new
segment.

```
trace_id  = root's id (inherited)
parent_id = preceding segment's id
```

Compacted conversations form a **chain**: root → compaction-1 → compaction-2.
Each segment's `parent_id` points to the previous segment. The chain is
ordered by `started_at`.

**What the adapter does:** Detects compaction boundaries in the source file,
splits one file into multiple ConversationRefs, assigns deterministic IDs
to continuations. See BP-04 §Compaction Splitting.

**What the store sees:** Multiple conversations with the same `trace_id`,
linked by `parent_id`, each with `relationship = 'compacted'`. The first
message of a compacted conversation is typically the compaction summary.

### spawned

A child conversation created by a parent — a sub-agent, a delegated task.
The parent's message stream contains the orchestration tool call that
triggered the spawn.

```
trace_id  = root's trace_id (inherited from parent)
parent_id = parent conversation's id
```

Spawned conversations form a **tree**: a parent can spawn multiple children,
and children can spawn their own children (sub-agents spawning sub-agents).

**fork_point:** The `fork_point` field records which turn in the parent
triggered the spawn. This enables display: "sub-agent was spawned at turn 5
of the parent conversation." Set to -1 if unknown.

**Bidirectional evidence:** The parent→child link exists in two places:
1. The child conversation's `parent_id` → gives you the tree structure
2. The parent's `tool_calls` table → gives you the timeline of when spawning
   happened and what prompt was delegated

Both are captured. Metadata gives you the tree. Tool calls give you the
story.

### forked

A branch from a specific turn — "try a different approach from turn N."
The fork shares history up to the fork point, then diverges.

```
trace_id  = root's trace_id (inherited)
parent_id = conversation being forked from
fork_point = turn number where the fork diverges
```

Forks are the least common relationship. Not all tools support them. The
model includes them for completeness — the schema is ready even if no
adapter produces forks today.

---

## The Trace

A **trace** is the complete set of conversations sharing a `trace_id`. It
represents one developer intent from start to finish, across compaction
boundaries, sub-agent spawns, and forks.

```
Trace: trace_id = "abc"
├── Conversation "abc"        (root)
│   ├── messages 1-50
│   └── spawned: Conversation "def" (sub-agent)
│       └── messages 1-12
├── Conversation "abc-c1"     (compacted continuation)
│   ├── messages 51-80        (summary + new messages)
│   └── spawned: Conversation "ghi" (sub-agent)
│       └── messages 1-8
└── Conversation "abc-c2"     (compacted continuation)
    └── messages 81-95
```

**Query:** `WHERE trace_id = 'abc'` returns all 5 conversations. Reconstruct
the tree from `parent_id`. Walk the compaction chain. Place sub-agents at
their `fork_point` in the parent's timeline.

### Trace Properties

- Every trace has exactly one root (`relationship = 'root'`)
- The root's `id` equals the `trace_id` (by convention, not enforced)
- All conversations in a trace share the same `trace_id`
- `parent_id` references are always within the same trace
- A trace can have zero or many compacted segments
- A trace can have zero or many spawned children at any level

---

## Combining Compaction and Spawning

Compaction and spawning can coexist in the same trace. A conversation can
be compacted, and both the original and the continuation can have sub-agents.

```
Trace: trace_id = "root"

root ──────────────────────► compacted-1 ─────────► compacted-2
 │ (turns 1-50)               │ (turns 51-80)        │ (turns 81-95)
 │                             │                      │
 ├── sub-agent-A (turn 12)     ├── sub-agent-C (55)   └── sub-agent-E (90)
 └── sub-agent-B (turn 30)     └── sub-agent-D (70)
```

Each box is a Conversation. All share `trace_id = "root"`. The compaction
chain links root → compacted-1 → compacted-2 via `parent_id`. Sub-agents
link to whichever segment they were spawned from.

---

## Invariants

### Adapter-Output Invariants

These rules must hold for the data each adapter produces. The testing
contract (BP-04) validates them against adapter output.

| # | Rule | Enforced By |
|---|------|-------------|
| 1 | Every conversation has a non-empty `trace_id` | Adapter |
| 2 | Root conversations have `trace_id = id` | Adapter |
| 3 | Non-root conversations have a non-empty `parent_id` | Adapter |
| 4 | `parent_id` references a conversation in the same trace | Adapter |
| 5 | Each trace's adapter output contains exactly one root | Adapter |
| 6 | Compacted segments form a linear chain (no branching) | Adapter |
| 7 | `fork_point >= 0` when relationship is `spawned` or `forked` (or -1 if unknown) | Adapter |
| 8 | `relationship` is one of: `root`, `compacted`, `spawned`, `forked` | Adapter + store CHECK |

### Eventual Store Invariants

These rules hold once all related conversations in a trace have been
ingested. They may be temporarily violated during ingest because the
pipeline writes one conversation bundle at a time (BP-02), and a child
can be written before its parent.

| # | Rule | Converges When |
|---|------|---------------|
| 9 | Every trace has exactly one root in the store | Root conversation is ingested |
| 10 | All `parent_id` references resolve to existing rows | Parent conversation is ingested |
| 11 | `trace_id` is consistent across the tree | All conversations in trace are ingested |

**parent_id is not a foreign key.** This is intentional — out-of-order
ingest must not be blocked by a missing parent. The store converges: once
the parent is ingested, the link resolves. See BP-05 for orphan detection
queries.

---

## Views Over the Model

The conversation model supports three views. Each is a different way to
read the same underlying data.

### Single Conversation

Show one conversation's messages in order.

```
WHERE conversation_id = ? ORDER BY sequence
```

This is the default view. No relationship awareness needed.

### Full Trace

Show the complete history across compaction boundaries and sub-agent
spawns.

**Data fetch:**
```
SELECT * FROM conversations WHERE trace_id = ?
SELECT * FROM messages WHERE conversation_id IN (...)
```

**Rendering is application logic, not a SQL sort.** A flat
`ORDER BY started_at, sequence` would clump each conversation's messages
together — it cannot interleave a child at the parent's spawn turn.

To render a trace inline:
1. Fetch all conversations and messages in the trace
2. Reconstruct the tree from `parent_id`
3. Walk the compaction chain (root → compacted-1 → compacted-2)
4. Within each segment, order messages by `sequence`
5. At each `fork_point`, insert the spawned child's messages inline
6. Presentation (inline, collapsed, tree) is a UI decision

The `parent_id` graph is the **causal order** — it is always correct
regardless of timestamp accuracy. Timestamps are display metadata, not
ordering primitives.

### Conversation Tree

Show the parent/child hierarchy — who spawned whom, which segments
are compacted continuations.

```
SELECT * FROM conversations WHERE trace_id = ?
→ reconstruct tree from parent_id
→ display as indented hierarchy
```

---

## What This Blueprint Does NOT Cover

| Topic | Blueprint |
|-------|-----------|
| How adapters detect compaction boundaries and sub-agents | BP-04 |
| SQLite schema for conversations table, indexes on trace_id | BP-05 |
| How the pipeline writes linked conversations atomically | BP-02 |
| Route matching on conversation fields | BP-08 |
| Per-tool compaction signals and sub-agent detection methods | Adapter investigation docs |
