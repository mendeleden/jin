---
title: Adapters
description: AI coding tools that jin can read and normalize.
sidebar:
  order: 4
---


Jin reads native local session data from supported AI coding tools.

| Adapter | Tool | Typical source |
| --- | --- | --- |
| `claude-code` | Claude Code | `~/.claude/projects/` JSONL |
| `cursor` | Cursor | Cursor workspace storage |
| `codex` | Codex CLI | `~/.codex/sessions/` JSONL |
| `warp` | Warp | Warp AI session logs |
| `gemini-cli` | Gemini CLI | `~/.gemini/` data |
| `kiro` | Kiro | Kiro session storage |
| `amp` | Amp | Amp conversation files |
| `opencode` | OpenCode | OpenCode session data |
| `pi` | Pi | Pi conversation logs |
| `piagent` | PiAgent | PiAgent session storage |

## Captured data

- Conversation metadata: project, branch, timestamps, adapter, model.
- Messages: role, content, sequence, tokens, and cost estimates.
- Tool calls: tool name, input, output, error state, and timing when available.
