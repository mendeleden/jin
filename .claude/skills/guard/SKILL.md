---
name: guard
description: Enable safety mode for destructive operations. Use during v2 migration work, schema changes, or any session touching PID files, databases, or remote sinks.
argument-hint: "[optional: specific guard scope like 'migration' or 'schema']"
---

# Guard Mode: $ARGUMENTS

Activate heightened awareness for destructive operations. This isn't a tool restriction — it's a checklist discipline.

## When to Use

- During v2 nuclear migration work (schema drops, re-creation)
- When modifying SQLite schema or migration logic
- When changing PID file management or daemon lifecycle
- When modifying sink push behavior (could push bad data to remote)
- When touching `store.ts`, `config.ts`, or any adapter's ID generation

## Active Guards

When guard mode is active, before executing any of these operations, **stop and confirm with the user**:

### Database Guards
- **DROP TABLE / DELETE FROM**: Never without explicit confirmation. Even in migration code — the user should know.
- **ALTER TABLE**: Show before/after schema. Confirm column additions won't break existing queries.
- **PRAGMA user_version change**: Confirm the version number and that all migrations in the sequence are present.
- **ON CONFLICT clause changes**: Show what gets overwritten. Upsert bugs silently corrupt data.

### File System Guards
- **PID file deletion**: Confirm no running process first (`kill -0 PID`).
- **Database file deletion/replacement**: Confirm backup exists or data is re-derivable.
- **Config file overwrite**: Show diff of what changes.

### Process Guards
- **SIGKILL to process**: Only after SIGTERM failed and a timeout elapsed.
- **Spawning background processes**: Confirm PID tracking is in place.
- **Writing to files in `~/.config/jin/`**: Confirm which file and why.

### Remote Guards
- **First push to a new sink**: Confirm endpoint and credentials.
- **Schema version mismatch with Postgres**: Halt and report, don't auto-proceed.
- **Pushing to production after migration**: Confirm the data looks correct with a sample before full push.

### ID Generation Guards
- **Any change to ID derivation logic**: This is the most dangerous class of change. Changed IDs = push log invalidation = duplicate data in sinks. Require a test that proves the same input produces the same ID before and after.

## How It Works

This skill doesn't block tools. It sets a behavioral contract:

1. When about to do something listed above, pause
2. State what you're about to do and why
3. State the rollback path if it goes wrong
4. Wait for explicit "go ahead"

## Deactivation

Guard mode is active for the current session. It resets on new session. If the user says "drop guard" or "I trust you on this", relax the checks for the remainder of the current task (not the full session).
