---
name: investigate
description: Systematic root-cause debugging. Use when something is known-broken and you need to find out why. Follows reproduce → hypothesize → isolate → verify → fix.
argument-hint: "[bug description, error message, or failing test]"
---

# Investigate: $ARGUMENTS

Something is broken. Find out why, systematically.

## Process

### 1. Reproduce

Before theorizing, confirm the bug exists and is reproducible.

- **Read the evidence**: Error message, failing test, user report, log output.
- **Reproduce if possible**: Run `bun test`, `bun run typecheck`, or the specific command that fails.
- **If not reproducible**: Document what was tried. A bug that can't be reproduced needs more data, not more guessing.

Capture:
```
Symptom: [what's wrong]
Reproduction: [exact steps or command]
Expected: [what should happen]
Actual: [what happens instead]
Frequency: [always | intermittent | only under X conditions]
```

### 2. Scope the Blast Radius

Before diving into code, understand how wide this could be:

- Which adapters are affected? (One? All? Only shared-DB adapters?)
- Which sinks? (Postgres upsert? S3 overwrite? Webhook delivery?)
- Which lifecycle path? (Daemon? Foreground? Service?)
- Is data being lost, corrupted, or just not appearing?

Check `docs/review/bugs.md` — is this a known issue (BUG-1 through BUG-7)?

### 3. Hypothesize

Generate 2-4 hypotheses for the root cause. For each:

```
Hypothesis: [what might be causing this]
Evidence for: [why this could be right]
Evidence against: [why this might be wrong]
Test: [how to confirm or rule out — specific file:line to check, query to run, log to read]
```

Rank by likelihood. Start with the most likely.

### 4. Isolate

For the top hypothesis, trace the code path:

- **Read the entry point**: Where does the failing operation start?
- **Trace the call chain**: Follow function calls through the layers (command → ingest → adapter → store → sink)
- **Find the divergence**: Where does the actual behavior diverge from expected?
- **Check the data**: Is the input to the failing function correct? Is the output wrong? Or is it the function itself?

Jin-specific investigation patterns:
- **Adapter bugs**: Read the raw source file (JSONL, SQLite, JSON) and compare against what the adapter returns. Is the parser wrong, or is the source data unexpected?
- **Store bugs**: Run `sqlite3 ~/.config/jin/store.db` queries to see what's actually in the database vs what the code thinks is there.
- **Sink bugs**: Check `_jin_push_log` for push history. Check the remote (Postgres/S3) for what was actually received.
- **Lifecycle bugs**: Check PID files (`~/.config/jin/jin.pid`), logs (`~/.config/jin/jin.log`), and process state (`ps aux | grep jin`).

### 5. Verify

Confirm the root cause before fixing:

- Can you predict the bug's behavior from the root cause? (If hypothesis is correct, changing X should change the symptom in Y way)
- Does the root cause explain all observed symptoms, not just some?
- Is there a minimal reproduction that isolates just this cause?

If verification fails, go back to step 3 with the next hypothesis.

### 6. Fix

Once root cause is confirmed:

- Implement the fix
- Run `bun run typecheck` and `bun test`
- If the bug wasn't caught by existing tests, write a test that would have caught it
- Check if the same pattern exists elsewhere (other adapters, other sinks, other lifecycle paths)

### 7. Report

```markdown
## Investigation: [title]

**Symptom**: [what was broken]
**Root cause**: [what was actually wrong — file:line]
**Fix**: [what was changed]
**Test**: [test added or existing test that now covers this]
**Related**: [BUG-* IDs if applicable, other files with same pattern]
**Blast radius**: [what else could have been affected]
```

If the investigation is substantial, suggest running `/compound` to capture the learning.
