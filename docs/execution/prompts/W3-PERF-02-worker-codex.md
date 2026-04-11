Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-full-runtime-rss-shutdown-flush`.

You are not alone in the shared canonical workspace. Other workers may be
active. Stay strictly inside this packet's owned files, do not revert anyone
else's edits, and do not absorb sink-bootstrap, Team/bootstrap, version-bump,
service-plist, PR, or unrelated product work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-02.md`
- `.execution/packets/W3-PERF-01.md`
- `.execution/packets/W3-ADAPTER-06.md`
- `.execution/packets/W3-BIN-01.md`
- `.execution/packets/W3-SERVICE-01.md`
- `.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`
- `.execution/reviews/2026-04-08-W3-ADAPTER-06-codex.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-full-runtime-rss-shutdown-flush.md` with:
- preferred session name: `codex-WORKER-full-runtime-rss-shutdown-flush`
- packet id: `W3-PERF-02`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs, audits, and code files named in the packet.

Current program context:
- `W3-PERF-01` was approved on a packet-local Codex ingest harness
- the installed/local `0.8.3` daemon still dies on the real workload
- disabling the dead local Postgres sink did not change the failure
- Railway schema is initialized, but remote rows are still `0/0`
- do not "fix" this by raising the hard limit or weakening the guard

Validation target:
- use the real local workload on this machine
- use the installed/local daemon path or an exact packet-local harness that
  faithfully reproduces the `ingest-adapter` / `shutdown-flush` failure
- record the exact commands, logs, and remote row counts in a durable audit

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`
- do not edit sink or Team/bootstrap code
- keep the BP-02 hard-limit behavior intact
- if the smallest safe fix requires widening into sink internals, stop and
  escalate

Target deliverables:
- full RCA for the remaining real-workload RSS failure
- smallest safe code fix
- focused regression coverage
- durable real-workload validation artifact
- explicit statement whether push-to-Postgres now lands rows

Acceptance checks:
- representative local-runtime validation no longer trips the RSS hard limit
  for `ingest-adapter` or `shutdown-flush`
- the hard limit is still enforced when intentionally exceeded
- completion report cites code + tests for each BP Acceptance Matrix row

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
