# Adapters

jin reads session data from 10 AI coding tools. Each adapter knows where the tool stores its data and how to parse it.

| Adapter | Tool | Data Location | Format |
|---------|------|---------------|--------|
| `claude-code` | Claude Code | `~/.claude/projects/` | JSONL |
| `cursor` | Cursor | `~/.cursor/` | SQLite (state.vscdb) |
| `codex` | Codex CLI | `~/.codex/sessions/` | JSONL (date-partitioned) |
| `warp` | Warp Terminal | `~/.warp/` | SQLite |
| `gemini-cli` | Gemini CLI | `~/.gemini/` | JSON |
| `kiro` | Kiro | `~/.kiro/` | SQLite |
| `amp` | Amp Code | `~/.amp/` | JSONL |
| `opencode` | OpenCode | `~/.opencode/` | JSON (hierarchical) |
| `pi` | Pi | `~/.pi/` | JSONL |
| `piagent` | PiAgent | `~/.piagent/` | JSON (DAG tree) |

## What gets captured

For each session:

- **Session metadata**: ID, timestamps, duration, active status, source path
- **Messages**: Role, content, model, token counts (input/output/cache)
- **Tool calls**: Name, input, output for each tool invocation
- **Thinking blocks**: Extended thinking content and token counts
- **Cost estimates**: Per-session cost based on model pricing

## Auto-detection

`jin init` checks for each tool's data directory. If found, the adapter is enabled in `~/.config/jin/config.json`.

Disable an adapter manually by setting `enabled: false` in the config:

```json
{
  "adapters": {
    "cursor": { "enabled": false }
  }
}
```
