# Watcher and daemon lifecycle

**Scope:** What happens after setup when you run `jin start` or `jin start --foreground`: process model, how adapters and filesystem watches feed the local `Store`, and how that differs from one-shot `jin ingest`.

## CLI routing: `start` vs `--foreground`

- **`jin start --foreground`** loads `watchCommand({ daemon: false })` directly — no `startCommand`.
- **Default `jin start`** uses `startCommand`, which daemonizes by calling `watchCommand({ daemon: true })` when no watcher is already running.

See `src/index.ts` (start case) and `src/commands/start.ts`.

## Foreground vs daemon

**Daemon path (`watchCommand({ daemon: true })`)**

1. Refuses to run if an OS service is already active (unless the process was launched by that service — env markers like `JIN_LAUNCHED_BY_SERVICE`).
2. If a PID file shows an existing live process, exits early; otherwise calls **`daemonize()`**.
3. **`daemonize()`** spawns a detached child running `start --foreground`, sets `JIN_DAEMON=1`, redirects stdout/stderr to `jin.log`, writes the child PID to `jin.pid`, parent exits.

**Foreground path**

- If `JIN_DAEMON` is unset and another watcher is already running (PID file + live process), exits with an error.
- Logging: under the daemon, lines go to the redirected log; in interactive foreground, output also appends to `jin.log`.

Primary implementation: `src/commands/watch.ts`. PID and stop semantics: `src/runguard.ts`, `src/lifecycle.ts` (`getWatcherState`, `stopWatcher`).

## How “running” is observed

- **Service mode:** systemd / launchd / Task Scheduler when active.
- **Daemon mode:** `jin.pid` plus `process.kill(pid, 0)` probe.

## Adapters and watch roots

1. **`allAdapters()`** — fixed list from `src/adapters/registry.ts`.
2. **Enabled + present:** adapters with `config.adapters[id].enabled` and successful `detect()` join `activeAdapters`.
3. **Auto-enable:** tools newly present on disk but previously disabled get flipped to enabled and config is saved.
4. **Watch registration:** for each active adapter, every path from `adapter.watchPaths()` is registered on `FileWatcher` with that adapter’s `id`.

If no active adapters remain, the watcher logs “Run `jin init` first” and exits.

`watchPaths` contract: `src/adapters/types.ts`. `fs.watch` + debounce: `src/watcher.ts`.

## How sessions and messages reach `Store`

- **`Store`** opens at `config.store.dbPath`; **`rawDir`** is ensured; **`jin.pid`** is written for the running watcher process.
- **Initial load:** `ingestAdapter` runs per active adapter; changed session IDs are collected for optional sink push.
- **`ingestAdapter`** (in `watch.ts`): lists sessions, `upsertSession`, then either **delta** (`newMessages` + `insertMessages`) when the adapter supports it and messages already exist, or **full** `messages` + `upsertMessages`. Uses a **stat cache** to skip unchanged source files. **`autoTagSession`** runs when messages change.
- **File events:** `onChange` resolves the adapter, excludes jin’s own output paths, applies a per-file cooldown, runs **`ingestSingleFile`**, queues session IDs for **debounced** `pushToSinks`.
- **Periodic poll:** every `config.watch.pollIntervalMs` (default 30s), `ingestAdapter` runs again for all active adapters to catch missed `fs.watch` events; may schedule pushes.
- **Shutdown:** flush pending sink pushes, close sinks and watcher, `store.close()`, remove PID file.

## Relationship to `jin ingest`

| Aspect | `ingestCommand` (`src/commands/ingest.ts`) | Watcher (`src/commands/watch.ts`) |
|--------|-------------------------------------------|-----------------------------------|
| Trigger | CLI / `init` one-shot | Long-running start + events + poll |
| Messages | Full `messages` + `upsertMessages` | Stat cache, optional `newMessages` delta |
| Artifacts | Yes (`adapter.artifacts`) | Not in the same path as batch ingest |
| Project stats | `refreshProjectStats` at end | Relies on tagging / store updates from ingest paths |

After **`jin init`**, the DB is warmed by **`ingestCommand`**. **`jin start`** does **not** call `ingestCommand`; it uses **`ingestAdapter` / `ingestSingleFile`** for continuous sync.

## File index

| Concern | Files |
|--------|--------|
| Start / service / UI orchestration | `src/commands/start.ts` |
| Watcher loop, daemonize, ingest, push scheduling | `src/commands/watch.ts` |
| PID / stop / component state | `src/lifecycle.ts`, `src/runguard.ts` |
| Filesystem watch debounce | `src/watcher.ts` |
| Adapter list | `src/adapters/registry.ts` |
| CLI dispatch | `src/index.ts` |
| One-shot ingest after init | `src/commands/init.ts`, `src/commands/ingest.ts` |
