# Architecture: adapters registry and auto-ingest (init path)

## Adapter registry (`src/adapters/registry.ts`)

- **`allAdapters()`** returns a fixed list of adapter instances: Claude Code, Cursor, Codex, Warp, Gemini CLI, Kiro, Amp, OpenCode, Pi, PiAgent.
- **`detectAdapters()`** (not used by `init` directly) filters that list by successful `detect()`; init inlines its own loop with extra bookkeeping (`detected` / `notFound`, config flags).

```13:26:src/adapters/registry.ts
export function allAdapters(): Adapter[] {
  return [
    new ClaudeCodeAdapter(),
    new CursorAdapter(),
    new CodexAdapter(),
    new WarpAdapter(),
    new GeminiCliAdapter(),
    new KiroAdapter(),
    new AmpAdapter(),
    new OpenCodeAdapter(),
    new PiAdapter(),
    new PiAgentAdapter(),
  ];
}
```

### Typical `detect()` pattern

Each adapter checks for tool-specific data on disk (logs, SQLite paths, etc.). Example from Cursor: presence of `~/.cursor/chats` workspace folders containing `store.db` under session dirs.

## Why init calls `ingestCommand`

After the detection loop, init sets `config.adapters[id].enabled` and saves. If **any** adapter was detected (`detected.length > 0`), init runs **`ingestCommand()`** so sessions (and derived projects) exist locally without a separate `jin ingest` step.

## Ingest command (`src/commands/ingest.ts`)

1. **`loadConfig()`** — re-reads config (including the flags just saved by init).
2. **`new Store(config.store.dbPath)`** — creates/opens SQLite.
3. Ensures **`config.store.rawDir`** exists.
4. Iterates **`allAdapters()`**:
   - Skip if `!config.adapters[adapter.id]?.enabled`.
   - **`detect()` again** — must still be true to ingest (handles races or transient state).
5. For each session: **`writeProgress`** → **`store.upsertSession`** → load messages → **`store.upsertMessages`** → **`autoTagSession`** (tagger derives project/tags/stats). Optional **`adapter.artifacts()`** → **`store.upsertArtifact`**.
6. **`store.refreshProjectStats()`**, **`clearProgress()`**, summary log, **`store.close()`**.

```8:23:src/commands/ingest.ts
export async function ingestCommand(): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  const adapters = allAdapters();
  // ...
  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
```

## Progress file (`src/progress.ts`)

- Path: `join(configDir(), "jin.progress")`.
- Updated per session during ingest; **`readProgress()`** ignores stale files (> 5 minutes).
- **`clearProgress()`** removes the file when ingest finishes.

## Persistence summary

| Data | Mechanism |
|------|-----------|
| Which adapters are on/off | `config.json` via `saveConfig` in init |
| Sessions, messages, tags, artifacts, project aggregates | SQLite via `Store` in ingest |
| Transient ingest UI | `jin.progress` |

## See also

- [command-init.md](./command-init.md) — detection vs ingest ordering and `--json` console suppression.
- [config-sinks-store.md](./config-sinks-store.md) — `store.dbPath` / `rawDir` defaults.
