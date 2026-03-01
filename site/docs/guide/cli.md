# CLI Commands

## Getting Started

| Command | Description |
|---------|-------------|
| `jin init [--team=<code>] [--skills]` | Detect tools, ingest, optionally register skills and connect to team sink |
| `jin connect [project]` | Interactive project → sink wiring |
| `jin start` | Start watcher in background |

## Running

| Command | Description |
|---------|-------------|
| `jin start [--service\|--ui\|--all]` | Start watcher in background |
| `jin start --foreground` | Watch + ingest (foreground) |
| `jin stop [--watcher\|--ui]` | Stop all running components |
| `jin restart` | Restart watcher |
| `jin status [--json\|--short]` | Status of all components |

## Connections

| Command | Description |
|---------|-------------|
| `jin connect <project> --postgres=...` | Connect project to a sink |
| `jin connections` | List all connections & sinks |
| `jin disconnect <project>` | Remove a project connection |
| `jin team-config --type=<sink> ...` | Generate team onboarding code |

## Data

| Command | Description |
|---------|-------------|
| `jin sessions [--adapter=X] [--since=24h]` | List sessions (--json for JSON) |
| `jin show <session-id> [--json]` | Show a session's messages |
| `jin stats [--adapter=X] [--since=24h]` | Token/cost analysis (--json for JSON) |
| `jin export [--format=json\|markdown]` | Export sessions to files |

## Dashboard

| Command | Description |
|---------|-------------|
| `jin ui [--port=4000]` | Web dashboard (foreground) |
| `jin ui start/stop/status` | Background dashboard management |
| `jin ui --tui` | Terminal UI |

## Admin

| Command | Description |
|---------|-------------|
| `jin service install\|uninstall\|status` | OS service management (systemd/launchd) |
| `jin update [--quiet\|--rollback]` | Self-update or rollback |
| `jin version` | Show version |
