Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-claude-code-token-accounting`.

You are not alone in the shared canonical workspace. Other workers may still
touch nearby files. Stay strictly inside this packet's owned files and do not
revert anyone else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-11-claude-code-token-accounting-investigation.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-ADAPTER-11.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-claude-code-token-accounting.md` with:
- preferred session name: `codex-WORKER-claude-code-token-accounting`
- packet id: `W3-ADAPTER-11`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Starting hypotheses to test:
- Claude may repeat the same billed `usage` across multiple assistant rows for a
  single logical turn
- Jin may currently sum those repeated rows directly
- Jin top-line token totals may exclude cache tokens even while cost estimation
  includes them

Constraints:
- only edit packet-owned files
- do not touch `src/pipeline/**`, `src/sinks/**`, or service/runtime code
- use real raw Claude samples or repo fixtures as evidence

Deliverables:
- packet-local audit
- focused tests if code changes land
- narrow fix only if the semantics are clear and safe
- completion report in the packet format
