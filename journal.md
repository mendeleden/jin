# Jin Setup Journal — 2026-02-24

Fresh setup: clear all sinks, configure Neon Postgres for healthi project.

---

## Step 1: Stop all running components

```
$ jin stop
  Stopping watcher (service)...
  Stopping dashboard (PID 228575)...
  Stopped.
```

## Step 2: Generate team config for healthi (Neon Postgres)

```
$ jin team-config --type=postgres \
    --connection-string="postgresql://neondb_owner:npg_MjYqwsaV0mx3@ep-mute-hall-ai43qll8-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require" \
    --team-id=healthi

  Team config generated.
  Config details:
  {
    "type": "postgres",
    "connectionString": "postgresql://neondb_owner:npg_MjYqwsaV0mx3@ep-mute-hall-ai43qll8-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    "prefix": "jin/",
    "teamId": "healthi"
  }

  Base64: eyJ0eXBlIjoicG9zdGdyZXMiLC...
```

## Step 3: Init with team code (replaces all existing sinks)

```
$ jin init --team=eyJ0eXBlIjoicG9zdGdyZXMiLC...

  sink: PostgreSQL connected
  + Claude Code  168 sessions
  - Cursor CLI, Codex, Warp Terminal, Gemini CLI, Kiro, Amp Code, OpenCode, Pi, PiAgent
  > postgres (healthi)
```

## Step 4: Uninstall stale OS service

```
$ jin service uninstall

  jin service — linux
  Removed jin.service
  Service uninstalled.
```

## Step 5: Start jin

```
$ jin start

  jin daemon started (PID 868075)
  Logs: /home/edmininode/.config/jin/jin.log
  Stop: jin stop
```

## Step 6: Verify status

```
$ jin status

  watcher     ● running    pid 868075    via daemon    uptime 0m
  dashboard   - stopped

  sessions  23     messages  15,219     cost  $14.71
  adapters    claude-code
  sinks       ● postgres/healthi
```

## Step 7: Push results

After ~4 minutes (15k messages to Neon over network):

```
[2026-02-24 03:17:01] Sink connected: PostgreSQL
[2026-02-24 03:17:01] Initial ingest...
[2026-02-24 03:17:06] Ingested 23 sessions, 15219 messages.
[2026-02-24 03:21:00] Pushed 22 to PostgreSQL, 1 failed
[2026-02-24 03:21:00]   Error: Session e0216647-...: PostgresError: invalid input syntax for type timestamp with time zone: ""
[2026-02-24 03:21:00] Watching for changes... (Ctrl+C to stop)
```

**Result: 22/23 sessions pushed successfully.** 1 session failed due to empty timestamp string — data quality issue in that session, not a sink bug.

## Final config state

```json
{
  "adapters": { "claude-code": { "enabled": true }, ... },
  "sinks": [{
    "type": "postgres",
    "connectionString": "postgresql://...@ep-mute-hall-ai43qll8-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    "prefix": "jin/",
    "teamId": "healthi",
    "developerId": "edmininode"
  }],
  "team": { "teamId": "healthi", "developerId": "edmininode", "syncMode": "realtime" }
}
```

## Bugs found during setup

1. **daemonize() broken in dev mode** — `/proc/self/exe` resolves to `bun`, so `[exe, "watch"]` becomes `bun watch` which looks for a package.json script. Fixed to detect compiled vs dev mode (same pattern as `startDetached()` in server.ts).
2. **Duplicate log lines** — every log line appears twice (daemon writes to file + stdout both going to same fd). Pre-existing, not addressed here.
3. **Empty timestamp in session e0216647** — Postgres rejects `""` as timestamp. The postgres sink should coalesce empty strings to NULL.

## Notes

- `jin init --team=<code>` replaces `config.sinks` entirely (clears old sinks)
- No routing rules configured = all sessions push to all sinks (backward compatible)
- Neon free tier: 0.5 GB storage, 100 CU-hours/month, up to 20 projects
