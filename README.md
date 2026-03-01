# jin

**A conversation data pipeline for agentic coding tools.**

Every day your team runs hundreds of AI coding sessions across Claude Code, Cursor, Codex, Gemini CLI, and more. Those conversations -- the prompts, the reasoning, the tool calls, the token costs -- vanish into tool-specific formats scattered across developer machines. No one knows what was built, how much it cost, or what patterns are emerging.

jin fixes that. It runs passively in the background, reads conversation data from 10 agentic coding tools, normalizes everything into a local SQLite store, and optionally pushes it to your team's infrastructure. No behavior change required. No IDE plugins. No wrappers around your tools. Just install, init, and forget.

---

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/jin/main/install.sh | sh
```

Single binary. Zero runtime dependencies. Works on Linux (x64, arm64) and macOS (x64, arm64).

Or build from source:

```sh
git clone https://github.com/YOUR_ORG/jin.git
cd jin
bun build ./src/index.ts --compile --outfile jin
```

## Quickstart

```sh
# 1. Detect which tools you have and create config
jin init

# 2. Start watching (background daemon)
jin start

# Done. Jin is now ingesting conversations as you work.
# Check what it found:
jin sessions --since=1h
jin stats
```

That's it. jin auto-detects your installed tools, watches their data directories with `fs.watch`, and ingests sessions as they update. The local SQLite store lives at `~/.config/jin/store.db`.

---

## Supported Tools

jin ships with 10 input adapters, each reading the native conversation format of its tool:

| Adapter       | Tool                                       | Data Source                    |
|---------------|--------------------------------------------|--------------------------------|
| `claude-code` | [Claude Code](https://claude.ai/code)      | `~/.claude/projects/` JSONL    |
| `cursor`      | [Cursor](https://cursor.com)               | Cursor workspace storage       |
| `codex`       | [Codex CLI](https://github.com/openai/codex) | Local codex session files    |
| `warp`        | [Warp](https://warp.dev)                   | Warp AI session logs           |
| `gemini-cli`  | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Gemini conversation data |
| `kiro`        | [Kiro](https://kiro.dev)                   | Kiro session storage           |
| `amp`         | [Amp](https://amp.dev)                     | Amp conversation files         |
| `opencode`    | [OpenCode](https://opencode.ai)            | OpenCode session data          |
| `pi`          | Pi                                         | Pi conversation logs           |
| `piagent`     | PiAgent                                    | PiAgent session storage        |

Adapters auto-detect whether each tool is present on the system. You can enable or disable individual adapters in `~/.config/jin/config.json`.

## Output Sinks

jin pushes data to three sink types, all configured through the same interface:

| Sink       | Targets                                | Protocol         |
|------------|----------------------------------------|------------------|
| `postgres` | Neon, Supabase, any PostgreSQL         | `libpq` over TCP |
| `s3`       | AWS S3, Cloudflare R2, MinIO, GCS      | AWS Signature V4 |
| `webhook`  | Any HTTP endpoint                      | POST with JSON   |

Sinks are configured in `~/.config/jin/config.json` or injected via team onboarding codes (see below). Multiple sinks can be active simultaneously.

---

## Commands

```
jin init [--team=<code>] [--skills]          Detect tools, ingest, register skills
jin start                                   Start watcher in background
jin start --foreground                      Watch + ingest (foreground)
jin stop                                    Stop all running components
jin status [--json|--short]                 Status of all components
jin connect [project]                       Interactive project → sink wiring
jin connections                             List all connections & sinks
jin disconnect <project>                    Remove a project connection
jin sessions [--adapter=X] [--since=24h]    List sessions (--json for JSON)
jin show <session-id> [--json]              Show a session's messages
jin stats [--adapter=X] [--since=24h]       Token/cost analysis (--json for JSON)
jin export [--format=json|md]               Export sessions to files
jin service install|uninstall|status        OS service (systemd/launchd)
jin team-config --type=<sink> ...           Generate team onboarding code
jin update [--quiet|--rollback]             Self-update or rollback
```

### Key workflows

**Personal use** -- just see what your AI tools have been doing:

```sh
jin init
jin sessions
jin stats
```

**Background daemon** -- continuous ingestion as you work:

```sh
jin start
jin status              # check it's running
jin sessions --since=4h # see recent sessions
```

**Persistent service** -- survives reboots, starts at login:

```sh
jin service install  # systemd (Linux), launchd (macOS), Task Scheduler (Windows)
jin service status
```

---

## Team Setup

jin supports a zero-friction team onboarding flow. One person configures the shared sink, everyone else joins with a single command.

### 1. Team lead generates a config code

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://user:pass@db.neon.tech/jin" \
  --team-id=myteam
```

This outputs a base64-encoded string:

```
eyJzaW5rIjoicG9zdGdyZXMiLCJjb25uZWN0aW9uU3RyaW5nIjoiLi4uIiwidGVhbUlkIjoibXl0ZWFtIn0=
```

### 2. Developers join

```sh
jin init --team=eyJzaW5rIjoicG9zdGdyZXMiLC4uLn0=
jin service install
```

That's it. Every developer's conversations now flow to the shared PostgreSQL database. No manual config editing, no credential distribution, no Slack threads asking "where do I put the connection string."

### Sink-specific examples

**S3 / R2 / GCS:**

```sh
jin team-config \
  --type=s3 \
  --bucket=my-jin-data \
  --region=us-east-1 \
  --access-key-id=AKIA... \
  --secret-access-key=... \
  --prefix=jin/ \
  --team-id=myteam
```

**Webhook:**

```sh
jin team-config \
  --type=webhook \
  --url=https://api.example.com/jin/ingest \
  --headers='{"Authorization":"Bearer tok_..."}' \
  --team-id=myteam
```

---

## Token and Cost Analysis

jin tracks token usage and estimates costs across all tools and models. The pricing engine covers Claude (Opus, Sonnet, Haiku), GPT-4/4o, o1/o3, and Gemini Pro/Flash families, with cache-aware cost calculation.

```sh
jin stats
```

```json
{
  "byAdapter": {
    "claude-code": { "sessions": 47, "messages": 1832, "tokens": 4210000, "cost": 38.12 },
    "cursor":      { "sessions": 23, "messages": 410,  "tokens": 890000,  "cost": 7.44 }
  },
  "byModel": {
    "claude-sonnet-4-1": { "messages": 1200, "inputTokens": 2800000, "outputTokens": 1100000 },
    "gpt-4o":            { "messages": 410,  "inputTokens": 600000,  "outputTokens": 290000 }
  }
}
```

Filter by adapter or time range:

```sh
jin stats --adapter=claude-code
jin sessions --since=7d --adapter=cursor
```

---

## Architecture

```
+------------------+
| Claude Code      |---+
| Cursor           |   |
| Codex            |   |    fs.watch + polling        +------------+
| Warp             |---+--> [ Adapters ] --> normalize --> [ SQLite ]
| Gemini CLI       |   |    (read-only, passive)      +------+-----+
| Kiro / Amp / ... |---+                                     |
+------------------+                                         |
                                                             | jin start (auto-push)
                                                             v
                                                    +-----------------+
                                                    | PostgreSQL      |
                                                    | S3 / R2 / GCS   |
                                                    | Webhook          |
                                                    +-----------------+
```

**Key design decisions:**

- **Read-only adapters.** jin never writes to or modifies your coding tools' data. It only reads.
- **Local-first.** Everything goes into `~/.config/jin/store.db` (SQLite with WAL mode). Sinks are optional.
- **fs.watch + polling fallback.** Real-time detection via OS file watchers, with a 30-second poll as a safety net.
- **Run guards.** A PID file at `~/.config/jin/jin.pid` prevents multiple daemon instances from conflicting.
- **Zero runtime dependencies.** Compiles to a single Bun binary. No npm packages at runtime.
- **AWS Sig V4 from scratch.** The S3 sink implements AWS Signature V4 signing directly -- no AWS SDK needed.

### Data model

Sessions and messages are stored in two tables with full token accounting:

- **sessions** -- id, adapter, name, timestamps, token totals, estimated cost, active status, sub-agent flag
- **messages** -- role, content, model, input/output tokens, cache read/write counts, tool uses, thinking blocks

---

## Why jin?

**The conversations are the most valuable artifact.** Your team writes thousands of prompts a week. Those prompts encode intent, architecture decisions, debugging strategies, and domain knowledge. Without jin, all of that evaporates the moment someone closes their terminal.

**Cost visibility is non-negotiable at scale.** When a team of 20 developers is burning through Claude Opus and GPT-4 sessions daily, someone needs to know the monthly bill before it arrives. jin gives you per-tool, per-model, per-developer cost breakdowns from data that already exists on every machine.

**No behavior change.** The tools that fail are the ones that ask developers to change how they work. jin installs in 30 seconds, detects your tools automatically, and runs as a background service. You never interact with it unless you want to.

**No vendor lock-in.** Your data stays in SQLite locally. Push it to Postgres, S3, or a webhook -- or don't push it anywhere. Switch sinks at any time. Export to JSON or Markdown. The data is yours.

---

## Configuration

jin stores its configuration at `~/.config/jin/config.json`. The `init` command creates this file with detected adapters enabled. You can edit it directly:

```json
{
  "adapters": {
    "claude-code": { "enabled": true },
    "cursor": { "enabled": true },
    "codex": { "enabled": false }
  },
  "sinks": [
    {
      "type": "postgres",
      "connectionString": "postgresql://...",
      "teamId": "myteam"
    }
  ],
  "store": {
    "dbPath": "~/.config/jin/store.db",
    "rawDir": "~/.config/jin/raw"
  },
  "watch": {
    "debounceMs": 200,
    "pollIntervalMs": 30000
  }
}
```

---

## Development

```sh
# Prerequisites: Bun (https://bun.sh)

# Install dev dependencies
bun install

# Run from source
bun run src/index.ts init
bun run src/index.ts start --foreground

# Type check
bun run typecheck

# Build binary
bun build ./src/index.ts --compile --outfile jin
```

---

## License

MIT
