Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-claude-code-id-collision`.

You are not alone in the shared canonical workspace. Other workers may still
touch nearby files. Stay strictly inside this packet's owned files and do not
revert anyone else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-ADAPTER-09.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-claude-code-id-collision.md` with:
- preferred session name: `codex-WORKER-claude-code-id-collision`
- packet id: `W3-ADAPTER-09`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Current live facts:
- `W3-ADAPTER-07` fixed default-path precedence and the child-recursion /
  stack-overflow failure
- `W3-VALIDATE-01` still found `6` duplicate loaded conversation IDs and `29`
  `UNIQUE constraint failed: messages.id` write failures on the real Claude
  dataset
- likely pressure is in conversation/message identity derivation; keep this
  lane functional and narrow unless Codex explicitly decides `W3-ADAPTER-08`
  is needed for safety

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`, `src/pipeline/**`, or `src/sinks/**`
- use the real local Claude dataset as validation input if needed

Deliverables:
- Claude duplicate-ID / `messages.id` collision fix if adapter-local
- focused regression tests
- Claude-only live validation rerun
- durable audit artifact
- completion report in the packet format
