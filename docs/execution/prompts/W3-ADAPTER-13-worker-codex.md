Work in `/home/edmininode/here-we-code/jin`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-13-codex-go-worker-parity.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-13.md`
- any relevant reviews for this packet

Only read the BP docs and code files named in the packet.
Only edit the owned files named in the packet.
Do not touch forbidden files.
Stop on any frozen-contract pressure.

Required operating behavior:
- create or update `.execution/agents/codex-WORKER-codex-go-worker.md` when you
  start
- keep heartbeat, current focus, and blockers current in that file
- keep the experiment Codex-specific; do not widen the Claude worker flag path
- implement TDD in the packet’s required order:
  1. unit Codex parser semantics
  2. worker command selection
  3. JSON-RPC streaming parity
  4. persisted-result parity
  5. normalized bundle-hash parity
  6. end-to-end acceptance validation
- preserve TS Codex semantics as ground truth unless Codex approval is
  explicitly required and recorded
- if `loadConversation`-only routing is unsafe because Codex ref parity breaks,
  stop and report that instead of widening scope silently

Validation target:
- exact persisted-result parity through `ingestConversationViaWorker`
- exact normalized bundle-hash parity on the verified Codex fixtures
- passing focused tests plus any acceptance check required by the packet

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
