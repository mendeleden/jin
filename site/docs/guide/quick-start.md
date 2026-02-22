# Quick Start

Three commands to get jin running on your machine.

## 1. Detect your tools

```sh
jin init
```

```
  + Claude Code  47 sessions
  + Codex  12 sessions
  - Cursor, Warp, Gemini CLI, Kiro, Amp, OpenCode, Pi, PiAgent

  ~/.config/jin/config.json

  Next: jin watch
```

## 2. Start the daemon

```sh
jin watch --daemon
```

This starts jin in the background. It watches all detected tools for new sessions and ingests them automatically.

Check status anytime:

```sh
jin status
```

## 3. Explore your data

```sh
# List recent sessions across all tools
jin list

# Cost and token breakdown
jin analyze

# View a specific session
jin show <session-id>

# Full markdown export
jin show <session-id> --markdown
```

## Register skills (optional)

Add `/jin` as a slash command in Claude Code, Gemini CLI, and Codex:

```sh
jin setup-skills
```

Now you can type `/jin list` or `/jin analyze` directly inside your coding tools.

## Run as OS service (optional)

To survive reboots without `--daemon`:

```sh
jin service install    # systemd (Linux) or launchd (macOS)
jin service status     # check it's running
jin service uninstall  # remove
```
