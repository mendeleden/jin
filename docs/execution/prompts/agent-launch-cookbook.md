# Agent Launch Cookbook

This file is the operator runbook for launching packet workers outside the main
Codex thread.

It covers the two launch paths currently in use:

- `codex exec` for Codex workers
- `claude -p` for Claude Code workers

The goals are:

- reproducible launch commands
- stable session identifiers
- detached execution with logs
- explicit control-plane recording

## Choose The Right Mode

Use these defaults.

### `codex exec`

Use for:

- Codex worker lanes that need write access
- resumable background work
- cases where you want JSON event logs and a saved last message

Prefer:

- `codex exec` for new runs
- `codex exec resume` for existing saved sessions

### `claude -p`

Use for:

- Claude Code worker lanes
- non-interactive resumable runs
- background work where you want a named session and a persisted session UUID

Prefer:

- `claude -p` for non-interactive execution
- `claude -r <session-id>` to resume an existing lane

### Do Not Default To Interactive TUI

Do not default to:

- `codex` interactive TUI
- `claude` interactive TUI

unless a human explicitly intends to drive the session live.

Interactive sessions are harder to monitor, harder to detach cleanly, and force
extra transcript scraping.

## Shared Conventions

### Session Names

Use stable operator-facing names:

- `codex-WORKER-<task-slug>`
- `claude-WORKER-<task-slug>`
- `cursor-REVIEWER-<task-slug>`
- `claude-REVIEWER-<task-slug>`

### Detached Hosting

Use `tmux` for detached long-running workers.

Suggested tmux session names:

- `jin-<packet-slug>`

Examples:

- `jin-w3-startup`
- `jin-w3-team`

### Log Paths

Write logs under:

- `.execution/logs/`

Suggested patterns:

- Codex event log:
  - `.execution/logs/<worker-name>.jsonl`
- Codex last message:
  - `.execution/logs/<worker-name>-last.txt`
- Claude stream log:
  - `.execution/logs/<worker-name>.stream.jsonl`

### Control-Plane Recording

Record the following in the live control plane:

In `.execution/agents/<agent-id>.md`:

- external session id
- tmux session name
- log path
- current status

In `.execution/program.md` active agents section:

- worker heartbeat path
- external session id
- tmux session
- log path

## Codex Worker: New Run

Prompt source:

- `docs/execution/prompts/<worker-prompt>.md`

Detached launch pattern:

```bash
tmux new-session -d -s jin-w3-startup \
  'cd /Users/edenmendel/Documents/GitHub/jin && \
   codex exec --full-auto --json \
     -o .execution/logs/codex-W3-STARTUP-01-last.txt \
     "$(cat docs/execution/prompts/W3-STARTUP-01-worker.md)" \
     >> .execution/logs/codex-W3-STARTUP-01.jsonl 2>&1'
tmux set-option -t jin-w3-startup remain-on-exit on
```

Notes:

- `--json` gives structured event output
- `-o` saves the final assistant message
- `--full-auto` maps to `workspace-write` plus `on-request`

## Codex Worker: Resume Existing Session

Use when a saved Codex session already exists and you want to continue it.

```bash
tmux new-session -d -s jin-w3-startup \
  'cd /Users/edenmendel/Documents/GitHub/jin && \
   codex exec resume --full-auto --json \
     -o .execution/logs/codex-W3-STARTUP-01-last.txt \
     019d6526-e1e2-7962-9d3e-f349f954a4d1 \
     "Continue from the current state and keep working until review_ready or a clear blocker. Keep updating .execution/agents/codex-WORKER-protected-source-opt-in.md as you go." \
     >> .execution/logs/codex-W3-STARTUP-01.jsonl 2>&1'
tmux set-option -t jin-w3-startup remain-on-exit on
```

## Claude Worker: New Run

Claude supports a custom display name and a fixed session UUID directly.

Detached launch pattern:

```bash
tmux new-session -d -s jin-w3-team \
  'cd /Users/edenmendel/Documents/GitHub/jin && \
   claude -p --verbose --output-format stream-json \
     --session-id d9a9d3a5-92d7-4acd-9ce8-d6b561860508 \
     -n claude-WORKER-team-bootstrap \
     --permission-mode auto \
     "$(cat docs/execution/prompts/W3-TEAM-01-worker-claude.md)" \
     >> .execution/logs/claude-WORKER-team-bootstrap.stream.jsonl 2>&1'
tmux set-option -t jin-w3-team remain-on-exit on
```

Important:

- if you use `--output-format stream-json`, also pass `--verbose`
- without `--verbose`, Claude exits immediately with a CLI error

## Claude Worker: Resume Existing Session

```bash
tmux new-session -d -s jin-w3-team \
  'cd /Users/edenmendel/Documents/GitHub/jin && \
   claude -p --verbose --output-format stream-json \
     -r d9a9d3a5-92d7-4acd-9ce8-d6b561860508 \
     -n claude-WORKER-team-bootstrap \
     --permission-mode auto \
     "Continue from the current state and keep working until review_ready or a clear blocker. Keep updating .execution/agents/claude-WORKER-team-bootstrap.md as you go." \
     >> .execution/logs/claude-WORKER-team-bootstrap.stream.jsonl 2>&1'
tmux set-option -t jin-w3-team remain-on-exit on
```

## Monitoring

Attach to a detached worker:

```bash
tmux attach -t jin-w3-startup
tmux attach -t jin-w3-team
```

List detached workers:

```bash
tmux ls
```

Tail logs:

```bash
tail -f .execution/logs/codex-W3-STARTUP-01.jsonl
tail -f .execution/logs/claude-WORKER-team-bootstrap.stream.jsonl
```

## Shutdown

Stop the detached worker session:

```bash
tmux kill-session -t jin-w3-startup
tmux kill-session -t jin-w3-team
```

This stops the local detached host process, but not the saved CLI session
metadata. Resume later with the same external session id if needed.

## Known Caveats

### Codex

- session identity is reliable by UUID
- thread names may not be first-class CLI flags in current versions
- use the UUID as the source of truth

### Claude

- `--permission-mode auto` may still hit a write gate depending on resume mode
  and the exact tool request
- if a resumed detached session blocks on writes, either:
  - relaunch with a more permissive permission mode, or
  - switch that lane back to an attached operator-driven session

### Shared Workspace

- detached workers still share the same repo state unless you isolate them with
  worktrees
- do not launch overlapping write scopes

## Minimum Operator Checklist

Before launch:

1. packet exists
2. prompt file exists
3. owned files are narrow
4. `.execution/program.md` and packet state are updated

After launch:

1. worker heartbeat exists
2. external session id is recorded
3. tmux session name is recorded
4. log path is recorded
5. next dispatches in `program.md` reflect reality

