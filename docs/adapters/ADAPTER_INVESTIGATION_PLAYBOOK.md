# Adapter Investigation Playbook

**Purpose:** Methodology for investigating how an AI coding tool stores
conversation data. Designed to produce a complete, verified picture in one
pass — not across three rounds of "oh, we missed that."

**Origin:** Codex investigation (2026-03-25 through 2026-03-28) required three
separate passes because the first pass used toy sessions that exercised ~10%
of runtime behaviors. Sub-agents, compaction, Desktop-specific tool calls,
turn interruptions, and web search were all discovered later from real usage.
See the retrospective in `docs/adapters/codex/investigation.md` Section 8.1.

**Replaces:** `INVESTIGATION_CHECKLIST.md` is now the quick-reference gate
checklist. This playbook is the full methodology.

---

## The Failure Pattern This Playbook Prevents

Every investigation miss we've had follows the same shape:

1. Run short, controlled sessions with simple prompts
2. Document the record types and fields we observe
3. Present the observations as a complete enumeration
4. Discover new record types weeks later from real usage

The root causes:

| Mistake | Example | Fix |
|---------|---------|-----|
| Tested with toy sessions | 1-2 turn prompts never trigger compaction | Phase 3: drive extreme sessions |
| Confused schema with behavior | `agent_nickname` column exists ≠ we know how sub-agents spawn | Phase 2: trace from schema to behavior |
| Guessed record types from names | Wrote `compaction` in docs, actual type was `compacted` | Phase 1: read the source |
| Wrote "not observed" as "doesn't exist" | `agent_jobs: 0 rows` → assumed sub-agents don't work | Confidence tagging |
| Didn't apply our own checklist | Checklist says "scan for orchestration tools" — we skipped it | Phase 4: gate review |

---

## Phase 0: Reconnaissance (Before Touching the Tool)

**Goal:** Know what you're looking for before you start observing.

### 0.1 Read the Source Code

If the tool's CLI or client is open source (npm, GitHub, crates.io), read it
first. This is the single highest-value step we've consistently skipped.

```bash
# Example for Codex
npm pack @openai/codex --dry-run 2>&1 | head -5    # find the package
npm view @openai/codex dist.tarball                 # download URL
# Or clone from GitHub if available
```

What to grep for:

| Target | Why | Example grep |
|--------|-----|-------------|
| Record type enum / string literals | Complete set of types, not just observed subset | `grep -r '"type"' --include="*.ts"` |
| Tool name definitions | All tools the agent can call, including orchestration | `grep -r 'name.*spawn\|name.*agent\|name.*fork'` |
| Session metadata fields | All fields on session_meta, not just the ones in our sample | `grep -r 'session_meta\|SessionMeta\|ThreadMeta'` |
| Compaction logic | How compaction works, what records it emits | `grep -r 'compact\|compaction\|replacement_history'` |
| Sub-agent / fork / spawn logic | How child sessions are created and linked | `grep -r 'spawn\|fork\|subagent\|sub_agent\|child_thread'` |
| Serialization format | What gets written to disk | `grep -r 'jsonl\|write_line\|append_record\|RolloutLine'` |

**If source is not available:** Skip to Phase 1 but mark every finding as
`(EMPIRICAL — source not reviewed)` in the docs.

### 0.2 Read Existing Documentation

Check the tool's official docs, API reference, changelog, and community forums
for storage format details. Tools often document their persistence model in
config or extension docs.

### 0.3 Prior Art

Check if Jin already has an adapter (`src/adapters/<tool>.ts`). Read what it
currently parses and what it ignores. The gaps are your investigation targets.

---

## Phase 1: Storage Discovery

**Goal:** Find everything on disk. Not interpret — just find.

### 1.1 Full Filesystem Scan

```bash
# Adjust TOOL_HOME for each tool
TOOL_HOME="$HOME/.codex"

# All databases
find "$TOOL_HOME" -name "*.sqlite" -o -name "*.db" -o -name "*.sqlite3" 2>/dev/null

# All structured data
find "$TOOL_HOME" -name "*.jsonl" -o -name "*.json" -o -name "*.ndjson" 2>/dev/null

# Everything else
find "$TOOL_HOME" -type f | head -50

# File sizes (large files = conversation data)
find "$TOOL_HOME" -type f -exec ls -lhS {} + 2>/dev/null | head -20
```

### 1.2 Database Schema Dump

For every SQLite/database file found:

```bash
sqlite3 "$DB_PATH" ".tables"
sqlite3 "$DB_PATH" ".schema"               # full DDL
sqlite3 "$DB_PATH" "SELECT count(*) FROM <table>" # row counts for every table
```

**Do not stop at "0 rows = not relevant."** Zero rows means "not yet triggered
on this machine." Document the schema and note it as untriggered.

### 1.3 Platform Paths

Document paths for all platforms immediately, even if you can only verify one:

| Platform | Path | Verified |
|----------|------|----------|
| macOS | `~/.tool/` | Yes |
| Linux | `~/.tool/` | No — inferred |
| Windows | `%APPDATA%\tool\` | No — inferred |
| WSL | `~/.tool/` | No — inferred |

---

## Phase 2: Type Enumeration (From Source, Not From Observation)

**Goal:** Build the complete record type table before running a single session.

### 2.1 If Source Code Is Available

Extract the complete enum/union of record types from source. This is
authoritative — the table should be built from this, with an "Observed" column
that starts empty.

### 2.2 If Source Code Is Not Available

Run a broad sample of sessions covering different scenarios (see Phase 3),
then enumerate. But mark the table header:

> **Record types: empirically observed (source not reviewed). This list may be
> incomplete.**

### 2.3 Confidence Column

Every record type, every field, every behavior claim gets a confidence tag:

| Confidence | Meaning | Criteria |
|------------|---------|----------|
| **Verified** | Observed in real data, structure documented with sample | Have a concrete JSON sample |
| **Inferred** | Schema/source suggests this exists, not yet observed | Column exists, or source code references it |
| **Speculative** | Guessed from naming convention or analogy to another tool | No evidence beyond "this name sounds like..." |

**Rule: Never write a Speculative claim without the tag.** The ontology listed
`compaction` and `agent_message` as Codex mechanisms — both were wrong. With
tags, we'd have known these were guesses.

---

## Phase 3: Deliberate Edge Case Sessions

**Goal:** Exercise every code path the tool supports, not just the happy path.

This is where our Codex investigation failed hardest. We ran 1-2 turn
sessions and called it done. The following matrix must be covered:

### 3.1 Session Complexity Matrix

| Scenario | What it tests | How to trigger |
|----------|--------------|----------------|
| **Minimal session** | Basic record types, session_meta | 1-turn, simple prompt |
| **Multi-turn session** | Turn boundaries, token accumulation | 5+ turns with follow-ups |
| **Tool-heavy session** | Tool call record types, I/O capture | "Read file X, edit Y, run Z" |
| **Long session → compaction** | Compaction record format, context handling | Keep prompting until context fills (~20+ turns with tool use) |
| **Sub-agent session** | Spawn/wait/join mechanism, child session format | "Use multiple agents to review X" or equivalent |
| **Interrupted session** | Abort/cancel record types | Start a response, then ctrl-C |
| **Desktop session (if IDE exists)** | IDE-specific record types, tool call schema differences | Same task via IDE, compare JSONL |
| **Resumed session** | Append behavior, ID reuse | Resume a prior session |
| **Ephemeral session (if supported)** | What gets skipped in non-persistent mode | `--ephemeral` or equivalent |

**For each scenario, embed a unique marker** (e.g. `[ADAPTER-EDGE-01]`) in
the prompt so you can grep for it across all storage layers.

### 3.2 Post-Session Scan

After EACH scenario, immediately scan for new/changed files:

```bash
# Before scenario
find "$TOOL_HOME" -name "*.jsonl" -newer /tmp/marker > /tmp/before.txt

# Run scenario

# After scenario
find "$TOOL_HOME" -name "*.jsonl" -newer /tmp/marker > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

**Do not just look at the file you expect.** The sub-agent miss happened
because sub-agents create sibling files in the same directory, and we only
looked at the parent file. Scan the entire output directory.

### 3.3 Record Type Delta

After each scenario, diff the record type census against what you had before:

```bash
# Full type enumeration for a JSONL file
python3 -c "
import json, sys
types = {}
for line in open(sys.argv[1]):
    obj = json.loads(line)
    t = obj['type']
    if t == 'response_item':
        t += ':' + obj.get('payload',{}).get('type','')
    elif t == 'event_msg':
        t += ':' + obj.get('payload',{}).get('type','')
    types[t] = types.get(t, 0) + 1
for t, c in sorted(types.items(), key=lambda x: -x[1]):
    print(f'  {t}: {c}')
" "$FILE"
```

**Any new type that appears is a finding that needs full documentation:**
full JSON sample, field descriptions, jin v2 mapping.

---

## Phase 4: Sub-Agent Deep Dive

Sub-agents have been the #1 source of investigation misses across both Cursor
and Codex. This phase is mandatory if the tool supports any form of
multi-agent or sub-task delegation.

### 4.1 Discovery: How Are Sub-Agents Spawned?

Do not assume the mechanism. Check all of these:

| Mechanism | Check |
|-----------|-------|
| Tool call in parent | grep parent JSONL for `spawn`, `agent`, `task`, `fork`, `delegate`, `subagent` |
| Metadata array on parent | Check if parent session has a list of child IDs (like Cursor's `subagentComposerIds`) |
| Separate directory | Check for `subagents/`, `agents/`, `children/` subdirectories |
| Same directory, different file | Diff file list before/after triggering sub-agents |
| Database table | Check for `agent_jobs`, `child_threads`, `spawned_tasks` tables |
| Structured `source` field | Check if child session_meta has parent reference (may be object, not string) |

### 4.2 Linkage: Can You Walk Parent ↔ Child?

**Bidirectional verification is mandatory:**

- **Parent → Child:** What in the parent identifies the child? (spawn output,
  metadata array, directory listing)
- **Child → Parent:** What in the child identifies the parent? (`parent_id`,
  `forked_from_id`, `source.subagent.parent_thread_id`)
- **Both must work.** If you can only go one direction, document the gap.

### 4.3 Format: Are Child Sessions Identical to Parent?

Check each of these — they're often different:

| Property | Same as parent? | Codex example |
|----------|----------------|---------------|
| File location | Maybe not | Same dir (not subdirectory) |
| Record types | Maybe not | Sub-agents had `web_search_call` parent didn't |
| `session_meta.source` | Often different | String for parent, object for child |
| Tool call types | Maybe mixed | Both `function_call` and `custom_tool_call` |
| Compaction behavior | Maybe independent | Sub-agents compact independently |
| Second `session_meta` | Maybe | Codex sub-agents re-emit parent's session_meta post-compaction |

### 4.4 Depth

Can sub-agents spawn sub-agents? If you see a `depth` field, try to trigger
depth > 1. If you can't trigger it, note it as unverified.

---

## Phase 5: Cross-Interface Comparison

If the tool has both CLI and IDE/Desktop interfaces, the JSONL format may
diverge in ways that aren't obvious from testing one interface.

### 5.1 Known Divergence Patterns

| Dimension | What to check | Codex example |
|-----------|--------------|---------------|
| Tool call record type | Different type names | CLI: `function_call`, Desktop: `custom_tool_call` |
| Tool call input schema | Different field names | CLI: `arguments` (JSON), Desktop: `input` (raw string) |
| Tool call output schema | Different structure | CLI: plain text, Desktop: JSON with `exit_code` |
| Session metadata | Additional fields | Desktop adds `read_thread_terminal` dynamic tool |
| Index/state files | Written by one, not the other | Desktop writes `session_index.jsonl`, CLI doesn't |

### 5.2 Side-by-Side Test

Run the same task (e.g., "read file X and edit line 5") via CLI AND Desktop.
Diff the resulting JSONL files structurally (not textually):

```bash
# Extract just the type sequences
python3 -c "..." cli_session.jsonl > /tmp/cli_types.txt
python3 -c "..." desktop_session.jsonl > /tmp/desktop_types.txt
diff /tmp/cli_types.txt /tmp/desktop_types.txt
```

---

## Phase 6: Documentation and Confidence Audit

### 6.1 Required Outputs

Every investigation produces these files (per `docs/adapters/index.md`):

| File | What it must contain |
|------|---------------------|
| `index.md` | Coverage gap table with confidence tags |
| `overview.md` | Record type table with Verified/Inferred/Speculative column |
| `investigation.md` | Runnable commands for every finding |
| `examples.md` | Real JSON sample for every record type claimed |
| `orchestration.md` | Programmatic interfaces and traceability results |

### 6.2 Completion Gate

Before declaring an investigation complete, run through this gate:

**Coverage:**

- [ ] Source code reviewed (or explicitly marked as not available)
- [ ] All storage locations found (not just the primary one)
- [ ] All database tables documented (including empty ones, with "untriggered" note)
- [ ] Every record type in the type table has a real JSON sample in examples.md
- [ ] Every record type in the type table has a confidence tag

**Edge cases exercised:**

- [ ] Session driven to compaction (or documented as "tool does not compact")
- [ ] Sub-agents triggered (or documented as "tool does not support sub-agents")
- [ ] Turn interrupted mid-execution
- [ ] Desktop/IDE session tested (if IDE exists)
- [ ] Multi-turn session with resume tested (if supported)
- [ ] File scan after each scenario (not just the expected file)

**Cross-checks:**

- [ ] Sub-agent linkage verified bidirectionally (parent→child AND child→parent)
- [ ] CLI vs Desktop JSONL structurally compared
- [ ] Ontology.md capability matrix updated with confidence tags
- [ ] Investigation checklist (`INVESTIGATION_CHECKLIST.md`) all boxes checked
- [ ] No Speculative claims without explicit tag

**Negative check (most important):**

- [ ] Every "not observed" / "not available" / dash in the capability matrix
      has been actively tested, not just "we didn't see it in our short session"

### 6.3 Known Unknowns Log

End every investigation with an explicit list of what you did NOT verify and
why. Not a generic "open questions" list — specific claims in the docs that
rest on incomplete evidence:

```markdown
## Known Unknowns

| Claim in docs | Confidence | What would verify it |
|---------------|------------|---------------------|
| "Codex does not support forking" | Inferred | Try `codex fork <id>`, check for new JSONL |
| "depth > 1 sub-agents not supported" | Inferred | Trigger sub-agent to spawn its own sub-agent |
| "`phase` only appears post-compaction" | Single observation | Check non-compacted Desktop sessions |
```

---

## Anti-Patterns

Things that have burned us. Do not do these.

| Anti-pattern | What happens | Do this instead |
|-------------|-------------|-----------------|
| "I ran 2 sessions and documented all types" | Miss half the types that only appear in edge cases | Run the full scenario matrix (Phase 3) |
| "Column exists in schema → I know how it works" | `agent_nickname` exists ≠ we know the spawn mechanism | Trace from schema to runtime behavior (Phase 2 + 4) |
| "Same format for CLI and Desktop" | Tool calls use completely different schemas | Side-by-side structural diff (Phase 5) |
| "0 rows in this table → not relevant" | Table populates under conditions you haven't triggered | Document as untriggered, try to trigger in Phase 3 |
| "I'll look at the parent file" | Miss 5 sub-agent files sitting next to it | Scan entire directory after every scenario |
| "This type name sounds like X → it must be X" | `agent_message` sounds like sub-agents, it's just text duplication | Verify with real data before documenting |
| Writing a finding without a JSON sample | Can't distinguish verified from speculated | Every claim gets a sample or a confidence tag |

---

## Cross-References

- [INVESTIGATION_CHECKLIST.md](./INVESTIGATION_CHECKLIST.md) — Quick-reference gate checklist (subset of this playbook)
- [docs/solutions/orchestration-tool-enumeration.md](../solutions/orchestration-tool-enumeration.md) — Origin story: missing Cursor's task_v2
- [docs/adapters/codex/investigation.md](./codex/investigation.md) — The investigation that motivated this playbook
- [docs/adapters/cursor/investigation.md](./cursor/) — The investigation that motivated the checklist
