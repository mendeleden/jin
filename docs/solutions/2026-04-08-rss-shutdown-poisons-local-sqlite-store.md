---
title: RSS shutdown can poison the local SQLite store
date: 2026-04-08
tags: [daemon, pipeline, migration, sqlite]
related: [W3-RUNTIME-01, W3-E2E-01]
---

# RSS shutdown can poison the local SQLite store

## Problem

During installed-binary validation, `jin team schema apply`, `jin team bridge`,
and `jin connect --team=... --remote=...` all worked, but the runtime never
reached a successful Postgres push.

The first visible failure was the runtime RSS kill switch:

- `RSS 976 MB exceeded the 256 MB hard limit during ingest batch for adapter codex`
- bounded shutdown started before remote rows landed

After that shutdown, follow-up one-shot ingest attempts failed locally with:

- `SQLiteError: attempt to write a readonly database`
- later, after moving `store.db-shm` / `store.db-wal` aside, `PRAGMA journal_mode = WAL`
  failed with `SQLiteError: unable to open database file`

This made the same local store unusable for continued validation even though:

- file ownership and mode bits were normal
- no process still had the DB open
- a copied `store.db` was writable

## Solution

For experimental v2, treat this as a hard-reset recovery case, not a migration
case.

Immediate recovery:

```sh
jin stop || true
rm -rf "$HOME/.config/jin"
```

Then reinstall/start fresh and recreate any team connection state.

For diagnosis, the useful discriminators were:

1. Postgres remained empty, so the bug was not in `jin team` bootstrap.
2. `jin status` showed correct local sink/route state, so routing was not the
   blocker.
3. Direct SQLite probes showed that ordinary `UPDATE` statements on the live
   store failed with `SQLITE_READONLY`.
4. Copying the DB to `/tmp` made the same write succeed.
5. Moving the live WAL/SHM sidecars aside removed the `READONLY` symptom, but
   reopening the live DB in WAL mode then failed with `SQLITE_CANTOPEN`.

## Key Insight

The primary release blocker is still the Codex ingest memory profile, but the
bounded RSS shutdown also leaves behind a second-order local recovery hazard:
the live SQLite store can become unusable for subsequent v2 commands.

For an experimental product, the right contract is:

- source files are the source of truth
- local SQLite state is disposable
- after this failure signature, reset local state instead of attempting repair

## Prevention

- Fix the Codex ingest RSS behavior so the hard limit is not hit on a normal
  local dataset.
- Detect this recovery signature on startup / ingest:
  - `SQLITE_READONLY` while updating `_jin_sync` or conversations
  - `SQLITE_CANTOPEN` when re-enabling WAL mode on the local store
- When detected, print a hard-reset message instead of surfacing raw SQLite
  errors:

```text
Experimental v2 local state is unrecoverable after the previous shutdown.
Remove ~/.config/jin and restart jin.
```

- Keep foreground-mode validation separate from service-mode validation while
  runtime stability is still being proven.

## Related

- `W3-E2E-01` proved the operator and developer bootstrap surfaces but exposed
  the runtime/push failure.
- `W3-RUNTIME-01` moved the live writer to the v2 pipeline, so this failure is
  in the active runtime path, not a legacy compatibility path.

## Files Changed

- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- `docs/execution/experimental-v2-reset-and-install.md`
