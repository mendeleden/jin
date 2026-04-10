# W3-BIN-01 Local Binary Smoke Audit

- date: `2026-04-08`
- packet: `W3-BIN-01`
- session: `codex-WORKER-local-binary-smoke`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- scope: `bounded local rebuild + binary smoke only`
- outcome: `passed`
- optional startup attempt: `not attempted`

## Command Log

### 1. `bun run build`

- exit code: `0`

```text
$ bun run scripts/embed-spa.ts && bun build ./src/index.ts --compile --outfile jin
  dashboard/dist/index.html not found, using placeholder → src/api/_spa.ts
  [34ms]  bundle  588 modules
  [93ms] compile  jin
```

### 2. `./jin version`

- exit code: `0`

```text
jin 0.8.2
```

### 3. `./jin team schema version`

- exit code: `0`

```text
  2.3
```

### 4. `./jin status --json`

- exit code: `0`

```json
{
  "runtime": {
    "state": "stopped",
    "issues": []
  },
  "components": [
    {
      "name": "watcher",
      "status": "stopped",
      "lifecycleState": "stopped"
    },
    {
      "name": "dashboard",
      "status": "stopped"
    }
  ],
  "paths": {
    "config": "/Users/edenmendel/.config/jin/config.json",
    "store": "/Users/edenmendel/.config/jin/store.db",
    "log": "/Users/edenmendel/.config/jin/jin.log"
  },
  "sessions": 20,
  "messages": 2929,
  "adapters": [
    "codex"
  ],
  "totalCost": 532.3515036000001,
  "sinks": [
    {
      "id": "team-local-postgres",
      "type": "postgres",
      "enabled": true
    },
    {
      "id": "team-railway-postgres",
      "type": "postgres",
      "enabled": true
    }
  ],
  "routes": [
    {
      "match": {
        "remote": "github.com/mendeleden/jin"
      },
      "sinks": [
        "team-local-postgres",
        "team-railway-postgres"
      ]
    }
  ]
}
```

### 5. `./jin connections`

- exit code: `0`

```text

  Routes:

    remote=github.com/mendeleden/jin  → team-local-postgres (postgres), team-railway-postgres (postgres)

  Destinations:

    team-local-postgres (postgres)  postgres  (1 route)
    team-railway-postgres (postgres)  postgres  (1 route)
```

## Notes

- The packet-required smoke set completed exactly as listed in the task packet.
- `./jin status --json` reported a stopped local runtime; this audit records command response only and does not claim runtime, perf, service, or release approval.
- No optional foreground startup was attempted.
