# v2 Runtime Bug Audit — 2026-04-07

**Version:** jin 0.8.2
**Branch:** `feat/rewrite-ontology`
**Store:** `~/.config/jin/store.db` (PRAGMA user_version = 1)
**Config:** `~/.config/jin/config.json`
**Investigator:** Claude (pair session with Eden)

---

## Environment Snapshot

```
$ jin status

  runtime     - stopped       not running
  sessions  20     messages  2,929     cost  $532.35
  adapters    codex
  sinks       ● team-local-postgres
  routes      1 configured
  log         ~/.config/jin/jin.log
  last error: RSS 976 MB exceeded the 256 MB hard limit
```

**Config:** 10 adapters enabled (claude-code, codex, cursor, warp, gemini-cli, kiro, amp, opencode, pi, piagent). 1 Postgres sink (`team-local-postgres` → `localhost:5444/jin_test`). 1 route matching `github.com/mendeleden/jin`.

**Raw data on disk:** 895 Claude Code JSONL files, 8 Codex JSONL files.

---

## Finding 1: Codex adapter produces duplicate conversations from one source file

### Reproduction

```bash
# Show which source files produced multiple conversations:
sqlite3 ~/.config/jin/store.db "
  SELECT source_path, COUNT(*) as n, GROUP_CONCAT(SUBSTR(id,1,12), ', ')
  FROM conversations
  GROUP BY source_path
  HAVING COUNT(*) > 1
  ORDER BY n DESC
"
```

### Observed

| Source file | Conversations produced | Expected |
|---|---|---|
| `rollout-…-019d65aa-4cbe-….jsonl` | 6 | depends on compaction count |
| `rollout-…-019d65aa-4c6a-….jsonl` | 6 | depends on compaction count |
| `rollout-…-019d65aa-4d14-….jsonl` | 3 | depends on compaction count |
| `rollout-…-019c81bc-….jsonl` | 2 | depends on compaction count |

One of the 6-conversation files contains:
- **3 `session_meta` records** (IDs: `019d65aa-4cbe…` as a subagent of `019d5a40…`, plus two `source: "vscode"` parents `019d5a40…` and `019d4acb…`)
- **5 `compacted` records** (each with `replacement_history`)
- **3,455 total lines**

```bash
# Verify with:
python3 -c "
import json
with open('$HOME/.codex/archived_sessions/rollout-2026-04-06T21-59-12-019d65aa-4cbe-7603-8209-4869e205376f.jsonl') as f:
    types = {}
    for line in f:
        r = json.loads(line.strip())
        types[r.get('type','?')] = types.get(r.get('type','?'), 0) + 1
    print(types)
"
# Output: {'session_meta': 3, 'event_msg': 1116, 'response_item': 2237, 'turn_context': 94, 'compacted': 5}
```

### Analysis

The adapter is splitting compaction boundaries into separate conversations (correct per v2 spec), but:

1. **Multiple `session_meta` IDs in one file** — the file contains 3 session_meta records representing a compaction chain (`019d4acb…` → `019d5a40…` → `019d65aa-4cbe…`). The adapter appears to create conversations for each session_meta AND each compaction segment, leading to double-counting.

2. **Hash-based IDs alongside UUID IDs** — the file produces 1 UUID-style ID (`019d65aa-4cbe…` from session_meta) and 5 SHA-hash IDs (e.g., `4069e27070…`). The hash IDs suggest the compaction-derived conversations are generating IDs by hashing content rather than deriving deterministically from the session_meta chain.

3. **Relationship data confirms the chain exists:**
```bash
sqlite3 ~/.config/jin/store.db "
  SELECT SUBSTR(id,1,12) as id, relationship, SUBSTR(parent_id,1,12) as parent, message_count
  FROM conversations
  WHERE source_path LIKE '%019d65aa-4cbe%'
  ORDER BY relationship
"
```
Output:
```
019d65aa-4cb  spawned      019d4acb-954  140
4069e2707088  compacted    019d65aa-4cb  182
ba35638f9928  compacted    4069e2707088  198
3280eaec5382  compacted    ba35638f9928  226
426ad8a513da  compacted    3280eaec5382  202
2cec2b7610c6  compacted    426ad8a513da  199
```

The compaction chain looks structurally correct (parent→child linking), but the **trace root `019d4acb…` doesn't exist as a conversation** in the store:

```bash
sqlite3 ~/.config/jin/store.db "SELECT COUNT(*) FROM conversations WHERE id = '019d4acb-954e-7181-9acf-fc816602c84d'"
# Output: 0
```

This means the trace is an orphan — you can't walk up to the root.

### Questions for investigation

- Is the adapter supposed to create conversations for ALL session_metas in a file, or just the one matching the filename?
- Should compaction segments that belong to parent sessions (from the same file) be emitted as separate conversations, or should they be attached to the parent's conversation chain?
- Where in the Codex adapter does the hash-based ID generation happen? Is it intentional or a fallback for missing session_meta?

---

## Finding 2: Daemon OOMs on every start (crash loop)

### Reproduction

```bash
jin start --foreground
# Wait ~5 seconds
# Or check the log after:
tail -5 ~/.config/jin/jin.log
```

### Observed

Every start attempt crashes with the same error:

```
[2026-04-08 01:01:49] ERROR: RSS 976 MB exceeded the 256 MB hard limit
  during ingest batch for adapter codex (20/160); starting bounded shutdown
```

The pattern is consistent across 4 consecutive start attempts in the log:
- 00:41:50 — RSS 960 MB, batch 20/160
- 00:42:47 — RSS 843 MB, batch 20/160
- 00:53:12 — RSS 864 MB, batch 20/160
- 01:01:49 — RSS 976 MB, batch 20/161

It always dies at batch item 20 out of 160+. The "160" likely represents total `ConversationRef`s returned by `findChanged()` — meaning the adapter is returning refs for conversations already in the store (no dedup at the ref level, or the hash-gating in `writeBundle` doesn't prevent parsing).

### Analysis

- 8 Codex files on disk, but `findChanged()` returns 160+ refs. This suggests compaction splitting happens at `findChanged` time, producing ~20 refs per file.
- All 160 refs parse into memory before any are written/discarded, causing the OOM.
- The 256MB hard limit is reasonable for a daemon; the bug is unbounded batch size during ingest.

### Questions for investigation

- Does the ingest coordinator batch by file or by conversation? It should process one file at a time to bound memory.
- Is the RSS check only at batch boundaries, or per-item? If per-batch, the entire batch is parsed before the check fires.

---

## Finding 3: Claude Code adapter produces zero conversations

### Reproduction

```bash
# Verify data exists:
find ~/.claude/projects/ -name "*.jsonl" | wc -l
# Output: 895

# Verify adapter is enabled:
cat ~/.config/jin/config.json | grep -A2 claude-code
# Output: "enabled": true

# Verify nothing ingested:
sqlite3 ~/.config/jin/store.db "SELECT COUNT(*) FROM conversations WHERE adapter_id = 'claude-code'"
# Output: 0

jin conversations --adapter=claude-code
# Output: (empty)
```

### Analysis

895 Claude Code JSONL files exist on disk. The adapter is enabled in config. But the daemon crashes before it gets to Claude Code (dies during Codex at batch 20/160). The adapter ordering in the ingest loop determines which adapters run — Codex runs first and OOMs before Claude Code gets a turn.

However, even a single `jin ingest` should process all adapters. Need to verify:

```bash
jin ingest 2>&1
```

If this also OOMs or skips Claude Code, the issue may be in adapter detection/discovery rather than just ordering.

---

## Finding 4: Conversation names are raw system prompts

### Reproduction

```bash
jin conversations 2>&1 | head -5
```

### Observed

Names show:
```
<environment_context> <cwd>/Users/edenmendel/Docum...
# AGENTS.md instructions for /Users/edenmendel/Doc...
```

### Expected (per ontology §2.1)

> `name` — Derived from first user message (truncated to 120 chars)

### Analysis

Codex sessions start with a system/environment message, not a user message. The adapter is using the content of the first message regardless of role, rather than finding the first `role: "user"` message. The `<environment_context>` XML and `# AGENTS.md` content are system-injected preambles, not user prompts.

---

## Finding 5: v1 schema tables still present alongside v2

### Reproduction

```bash
sqlite3 ~/.config/jin/store.db ".tables"
```

### Observed

```
_jin_push_attempts    messages_fts_config   session_tags
_jin_push_state       messages_fts_data     sessions
_jin_sync             messages_fts_idx      tags
artifacts             projects              tool_calls
conversations         push_log              tool_usage
messages              session_projects
```

v1 tables present: `sessions`, `projects`, `session_projects`, `session_tags`, `tags`, `artifacts`, `tool_usage`, `push_log`.

v2 tables present: `conversations`, `messages`, `tool_calls`, `_jin_sync`, `_jin_push_state`, `_jin_push_attempts`.

The `sessions` table is empty (`SELECT COUNT(*) FROM sessions` → 0), so the v2 migration did run. But the v1 tables were not dropped — they're dead weight.

### Impact

Low — no data corruption risk. But `PRAGMA user_version = 1` suggests the migration system may not be tracking v1→v2 cleanup as a migration step.

---

## Finding 6: 8th Codex file not ingested

### Reproduction

```bash
ls ~/.codex/archived_sessions/ | wc -l
# Output: 8

sqlite3 ~/.config/jin/store.db "
  SELECT DISTINCT source_path FROM conversations
" | wc -l
# Output: 7 (the 8th file rollout-…-019d65aa-4d63-… has 0 conversations)
```

### Analysis

The daemon OOMs at batch 20/160 — it never finishes processing all files. The 8th file (`019d65aa-4d63…`) was likely in the queue but never reached.

---

## Summary

| # | Bug | Severity | Category |
|---|-----|----------|----------|
| 1 | Codex adapter creates duplicate conversations from compaction chains in multi-session files | High | Adapter / ID generation |
| 2 | Daemon OOMs every start at RSS ~900MB during Codex ingest | Critical | Pipeline / memory |
| 3 | Claude Code adapter never runs (blocked by Codex OOM) | High | Pipeline / ordering |
| 4 | Conversation names use raw system prompt instead of first user message | Low | Adapter / naming |
| 5 | v1 tables not cleaned up after v2 migration | Low | Schema / migration |
| 6 | Trace root conversation missing (orphan chain) | Medium | Adapter / compaction |

### Suggested investigation order

1. **OOM (#2)** — unblocks everything else. The daemon can't run.
2. **Duplicate conversations (#1 + #6)** — the core ID/compaction logic needs to be correct before scaling.
3. **Claude Code (#3)** — once OOM is fixed, verify this works.
4. **Names (#4)** — quick fix once the adapter logic is understood.
