# Adapter Data Investigation Checklist

Quick-reference gate checklist. Run through this before declaring an
investigation complete. For the full methodology, see
[ADAPTER_INVESTIGATION_PLAYBOOK.md](./ADAPTER_INVESTIGATION_PLAYBOOK.md).

**Origin:** We missed Cursor's `task_v2` sub-agent spawn mechanism because we
enumerated leaf tools (read_file, grep) but not orchestration tools. Then we
missed Codex's `spawn_agent`/`wait_agent`, `custom_tool_call`, `compacted`, and
3 other record types because we only ran toy sessions. See
`docs/solutions/orchestration-tool-enumeration.md` and
`docs/adapters/codex/investigation.md` Section 8.1.

---

## 1. Storage Discovery

- [ ] List all storage locations (files, DBs, directories) for this tool
- [ ] Document exact paths per platform (macOS, Linux, Windows)
- [ ] Identify all file formats (SQLite, JSONL, JSON, protobuf, binary)
- [ ] Note mixed formats (e.g., JSON + protobuf in same table)

## 2. Message-Level Data

- [ ] Extract all message fields (role, content, timestamp, model, metadata)
- [ ] Verify token counts (per-message vs per-session vs absent)
- [ ] Check for thinking/reasoning blocks
- [ ] Determine timestamp granularity (per-message, interpolated, or absent)

## 3. Tool Call Enumeration — Leaf Level

- [ ] **Enumerate ALL tool types**, not just observed ones
  - SQLite: `SELECT DISTINCT tool_name` or parse toolFormerData
  - JSONL: regex all `tool_use` blocks, categorize by `name`
- [ ] For each tool: extract name, input, output, status, id
- [ ] Check for tool result blocks separately (may be in different rows/messages)

## 4. Tool Call Enumeration — Orchestration Level

> This is the step we missed. See `docs/solutions/orchestration-tool-enumeration.md`.

- [ ] **Scan parent sessions for agent management tool calls**
  - task_v2, spawn, Task, agent_message, create-subagent, etc.
  - These manage other agents/sessions, not files
- [ ] For each orchestration tool, extract:
  - Delegated task description / prompt
  - Child agent ID (result.agentId or equivalent)
  - Model used for the child
  - Completion status
- [ ] Verify parent→child linkage is bidirectional:
  - Parent contains spawn event in message stream
  - Child is discoverable via parent's metadata field (e.g., subagentComposerIds)

## 5. Sub-Agent Structure

- [ ] If sub-agents exist:
  - [ ] Find all child session IDs (explicit field AND directory structure)
  - [ ] Verify parent's message stream mentions the spawn (Section 4)
  - [ ] Verify each child has independent message stream
  - [ ] Check for tree depth > 2 (sub-agents spawning sub-agents)
  - [ ] Document which storage layers each child appears in

## 6. Cross-Layer Correlation

- [ ] ID matching across layers (exact UUID equality)
- [ ] Data completeness differences between layers
- [ ] Verify sessions don't appear unexpectedly in wrong layers

## 7. Data Completeness Matrix

Fill this in for your adapter:

| Data Point | Layer 1 | Layer 2 | Layer 3 | Notes |
|-----------|---------|---------|---------|-------|
| Message text | | | | |
| Token counts | | | | per-msg or per-session? |
| Tool inputs | | | | |
| Tool outputs | | | | |
| Orchestration tools | | | | **task_v2 etc.** |
| Thinking blocks | | | | |
| Timestamps | | | | per-msg granularity? |
| Sub-agent IDs | | | | |
| Sub-agent content | | | | |
| Model info | | | | |

## 8. Edge Case Scenarios (from Playbook Phase 3)

- [ ] Session driven to **compaction** (or documented as unsupported)
- [ ] **Sub-agents** triggered (or documented as unsupported)
- [ ] Turn **interrupted** mid-execution (ctrl-C / cancel)
- [ ] **Desktop/IDE** session tested (if IDE exists)
- [ ] **Multi-turn** session with resume tested (if supported)
- [ ] Full directory scan after each scenario (not just the expected file)

## 9. Confidence Audit

- [ ] Every record type in the docs has a **real JSON sample**
- [ ] Every record type has a **confidence tag** (Verified / Inferred / Speculative)
- [ ] Every "not available" in the capability matrix was **actively tested**
- [ ] No Speculative claims exist without explicit `(SPECULATIVE)` tag
- [ ] CLI vs Desktop JSONL compared structurally (if both exist)

## 10. Verification

- [ ] Every finding has a runnable command (sqlite3, grep, python3, etc.)
- [ ] Commands work on fresh data, not just investigator's local state
- [ ] Cross-platform commands documented (macOS, Linux, Windows)
- [ ] Source code reviewed (or explicitly marked as unavailable)
