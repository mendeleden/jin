# Register Skills

jin can register itself as a slash command in your AI coding tools so you can query session data without leaving your editor.

## Install

```sh
jin init --skills
```

```
  + Claude Code  installed
  + Gemini CLI   installed
  - Codex        not detected
```

## What gets installed

| Tool | File | Command |
|------|------|---------|
| Claude Code | `~/.claude/skills/jin/SKILL.md` | `/jin sessions`, `/jin stats` |
| Gemini CLI | `~/.gemini/commands/jin.toml` | `/jin sessions`, `/jin stats` |
| Codex | `~/.codex/AGENTS.md` (appended) | Behavioral — mention "jin" or "session history" |

## Usage

In Claude Code or Gemini CLI:

```
/jin sessions
/jin stats
/jin show abc123
```

The AI will run the command and present the results in context.
