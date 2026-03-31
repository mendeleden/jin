# Architecture notes (`docs/architecture/`)

High-level, module-oriented notes for the **jin** codebase. Paths are relative to the repo root.

## Init and local pipeline

| Document | Topic |
|----------|--------|
| [00-jin-init-first-run.md](./00-jin-init-first-run.md) | First `jin init` sequence + diagram |
| [cli-entry.md](./cli-entry.md) | `src/index.ts` → commands |
| [command-init.md](./command-init.md) | `src/commands/init.ts` |
| [config-sinks-store.md](./config-sinks-store.md) | Config dir, `config.json`, SQLite paths, sinks |
| [adapters-ingest.md](./adapters-ingest.md) | Registry + `ingestCommand` + progress |

## Runtime, team sync, UI, quality

| Document | Topic |
|----------|--------|
| [watcher-daemon-lifecycle.md](./watcher-daemon-lifecycle.md) | `jin start`, daemon, `watch.ts`, `Store` updates vs `ingest` |
| [routing-connect-sink-push.md](./routing-connect-sink-push.md) | `connect`, `routing.ts`, `pushToSinks`, sink types |
| [adapter-claude-code.md](./adapter-claude-code.md) | Reference adapter: paths, IDs, messages, `watchPaths`, artifacts |
| [api-dashboard.md](./api-dashboard.md) | `src/api/*`, dashboard `fetch` + SSE |
| [testing-contracts.md](./testing-contracts.md) | What tests and perf harness guarantee |

These deeper docs were produced with parallel codebase exploration and cross-checked against sources; line numbers in older snapshots may drift — prefer reading the cited files when in doubt.
