# Configuration

jin stores its config at `~/.config/jin/config.json`.

## Default config

```json
{
  "adapters": {
    "claude-code": { "enabled": true },
    "cursor": { "enabled": false },
    "codex": { "enabled": true }
  },
  "store": {
    "dbPath": "~/.config/jin/store.db",
    "rawDir": "~/.config/jin/raw"
  },
  "watch": {
    "debounceMs": 200,
    "pollIntervalMs": 30000
  },
  "sinks": [],
  "team": null
}
```

## Paths

| Path | Purpose |
|------|---------|
| `~/.config/jin/config.json` | Main configuration |
| `~/.config/jin/store.db` | SQLite database (sessions, messages, tags, projects) |
| `~/.config/jin/raw/` | Raw copies of ingested session files |
| `~/.config/jin/jin.pid` | PID file for daemon mode |
| `~/.config/jin/jin.log` | Daemon log file |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `XDG_CONFIG_HOME` | `~/.config` | Base config directory |
| `CODEX_HOME` | `~/.codex` | Override Codex data directory |
