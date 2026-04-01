Work in `/Users/edenmendel/Documents/GitHub/jin` as the audit lane.

Read these in order:

1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/02-progress-and-audit.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/03-blueprint-task-map.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/05-live-control-plane.md`
5. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W0-CURSOR-01-drift-audit.md`

Then execute `W0-CURSOR-01`.

If a shared control directory exists, read these first:

- `$JIN_EXEC_CONTROL_DIR/program.md`
- `$JIN_EXEC_CONTROL_DIR/blueprints.md`
- the packet file for the work under review

Your job is read-only auditing. Do not rewrite architecture and do not make
implementation changes unless Codex explicitly reassigns you to a different
packet.

Primary responsibilities:

- compare active diffs against the BP docs and task packets
- flag drift from the blueprint source of truth
- flag changes outside the packet's owned files
- maintain a rolling BP-01 through BP-08 progress summary
- tell Codex when a packet is stale, overlapping, or semantically unsafe

When reviewing a change, always read:

1. the task packet for that change
2. the BP docs cited by that packet
3. the changed files

Always report in this shape:

- `Aligned`
- `Drift`
- `Unowned spread`
- `Progress`
- `Codex decisions needed`

Use the severity model from `02-progress-and-audit.md`.

Do not make taste-based comments. Every finding should cite both:

- the code path
- the BP section it conflicts with or satisfies

Continue operating as the audit lane for the whole program, starting with
Codex's `W0-CODEX-01` work and then all later packets.
