# CLI Commands

## Core

| Command | Description |
|---------|-------------|
| `jin init [--team=<code>]` | Detect tools, create config, optionally connect to team sink |
| `jin watch [--daemon]` | Start watching for new sessions. `--daemon` runs in background |
| `jin stop` | Stop the background daemon |
| `jin status` | Show daemon status and ingestion stats |
| `jin ingest` | One-shot ingest from all detected tools |

## Query

| Command | Description |
|---------|-------------|
| `jin list [--adapter=X] [--since=24h] [--limit=50]` | List ingested sessions |
| `jin show <session-id> [--markdown]` | Show a session's messages |
| `jin analyze [--adapter=X]` | Token/cost analysis by tool and model |

## Data

| Command | Description |
|---------|-------------|
| `jin push [--endpoint=URL]` | Push sessions to configured sinks |
| `jin export [--format=json\|markdown] [--output=dir]` | Export sessions to files |

## Setup

| Command | Description |
|---------|-------------|
| `jin setup-skills` | Register /jin in Claude Code, Gemini CLI, Codex |
| `jin team-config --type=<sink> ...` | Generate team onboarding code |
| `jin service install\|uninstall\|status` | OS service management (systemd/launchd) |

## Meta

| Command | Description |
|---------|-------------|
| `jin update` | Self-update to latest release |
| `jin version` | Show version |
