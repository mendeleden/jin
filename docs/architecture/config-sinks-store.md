# Architecture: config, sinks, and local store (init-related)

## Config module (`src/config.ts`)

### Paths

- **`configDir()`** — `JIN_CONFIG_DIR` if set; else on Windows `LOCALAPPDATA/jin` (or fallback under home); else `~/.config/jin`.
- **`configPath()`** — `join(configDir(), "config.json")`.

### Lifecycle helpers

- **`ensureConfigDir()`** — `mkdirSync(configDir(), { recursive: true })` when missing.
- **`defaultConfig()`** — All bundled adapters listed with `{ enabled: true }`, empty `sinks`, `store.dbPath` and `store.rawDir` under `configDir()`, watch tuning defaults.
- **`loadConfig()`** — Ensures dir, reads `config.json` if present, returns `{ ...defaultConfig(), ...saved }` (shallow merge).
- **`saveConfig(config)`** — Ensures dir, `Bun.write(configPath(), JSON.stringify(config, null, 2))`.

### Types (high level)

- **`JinConfig`** — `adapters`, `sinks`, optional `routes`, `defaultSinks`, `routeUnmatchedToAll`, optional `team`, `store`, `watch`.
- **`TeamConfig`** — `teamId`, `developerId`, `syncMode` (`realtime` | `periodic` | `manual`).

## What first `jin init` tends to create

| Artifact | When |
|----------|------|
| Config directory | First `ensureConfigDir()` / `loadConfig()` |
| `config.json` | After `saveConfig()` at end of init’s adapter phase (always on a normal init run) |
| `store.db` + WAL files | When `ingestCommand` or any code opens `Store` at `config.store.dbPath` — **init skips ingest if zero adapters detected**, so DB may not exist yet |
| `raw/` under config dir | `ingestCommand` ensures `config.store.rawDir` exists when ingest runs |
| `jin.progress` | During ingest; removed by `clearProgress()` when ingest completes |

## Store (`src/store.ts`)

Constructor ensures parent directory of `dbPath` exists, opens SQLite, applies schema PRAGMAs, runs `SCHEMA` + `migrate()`.

```137:147:src/store.ts
  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }
```

## Sinks (`src/sinks/types.ts`, `src/sinks/registry.ts`)

- **`SinkConfig`** — discriminated by `type`: `webhook` | `postgres` | `s3`, plus shared fields like `teamId`, `developerId`, `batchSize`.
- **`decodeTeamConfig` / `encodeTeamConfig`** — base64 JSON carrier for team onboarding codes used with `jin init --team=...`.
- **`createSink(config)`** — constructs the appropriate sink implementation for health checks and later pushing.

## Optional `--skills` disk effects

`src/commands/setup-skills.ts` writes into tool-specific locations under the user’s home directory (Claude skills, Gemini commands, etc.); that is separate from `configDir()`.

## See also

- [command-init.md](./command-init.md) — when team and saveConfig run.
- [adapters-ingest.md](./adapters-ingest.md) — when the store is first populated.
