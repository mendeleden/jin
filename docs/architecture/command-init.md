# Architecture: `initCommand` (`src/commands/init.ts`)

**Module:** `src/commands/init.ts`  
**Exports:** `initCommand(opts?)`  
**Role:** On first setup (and on repeat runs), ensure config exists, optionally join a team sink, detect coding-tool adapters, persist adapter enable flags, auto-run ingest when anything was detected, print guidance, optionally open interactive connect or register skills.

## Dependencies (imports)

| Import | Use |
|--------|-----|
| `../config` | `ensureConfigDir`, `loadConfig`, `saveConfig`, `configPath` |
| `../store` | `Store` — for `--json` project listing after ingest |
| `../adapters/registry` | `allAdapters()` |
| `../sinks/types` | `decodeTeamConfig` |
| `../sinks/registry` | `createSink` (note: `availableSinks` is imported but unused) |
| `./ingest` | `ingestCommand` |

## Ordered behavior

1. **`ensureConfigDir()`** then **`loadConfig()`**.

2. **`--team`** (optional): decode base64 → `SinkConfig`; default `developerId` from `USER` / `USERNAME` or `dev-<timestamp>`. Append sink if not duplicate (same `type`, `connectionString`, `url`, `bucket`). Set `config.team` with `syncMode: "realtime"`. `createSink` → `healthCheck` → `close`. Any throw → error message and **`process.exit(1)`**.

3. **Adapter loop:** for each adapter from `allAdapters()`:
   - Try `detect()`. If true: `sessions()`, push to `detected`, set `config.adapters[adapter.id] = { enabled: true }`.
   - If false: push name to `notFound`, set `enabled: false`.
   - **On throw:** only `notFound` is updated; **`config.adapters[adapter.id]` is not set in that iteration**, so it keeps whatever value it already had (from defaults or previous `config.json`).

4. **`saveConfig(config)`** — always writes current adapter flags and any team/sink updates.

5. **Auto-ingest:** if `detected.length > 0`, call `ingestCommand()`. In `--json` mode, `console.log` is temporarily no-op’d during ingest so ingest logs do not corrupt JSON output.

6. **`--json`:** open `Store`, `listProjects()`, print one JSON object (`detected`, `notFound`, `sinks`, `projects`, `config` path), **return** — no human banner, no connect handoff, **no `--skills`** in this path.

7. **Human output:** detected adapters (+ session counts), dim list of not-found tools, sink summary, `configPath()`.

8. **Next steps:** if `config.sinks.length > 0` and no `routes`, suggest `jin connect`. If also `opts.team` and **stdin is a TTY**, dynamically import `./connect` and run **`interactiveConnect({})`**. Otherwise suggest `jin start`.

9. **`--skills`:** dynamic import `./setup-skills`, `setupSkillsCommand()` — only if execution reaches this point (not after `--json` early return).

## Design intent (from source comments)

- “Auto-ingest so projects are immediately discoverable” — avoids a separate manual ingest right after first init when tools are present.

## See also

- [config-sinks-store.md](./config-sinks-store.md) — where config and DB live.
- [adapters-ingest.md](./adapters-ingest.md) — what `ingestCommand` does with enabled adapters.
- [cli-entry.md](./cli-entry.md) — which flags reach this function.
