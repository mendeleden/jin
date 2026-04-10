Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-claude-code-live-hardening`.

You are not alone in the shared canonical workspace. Other workers are active.
Stay strictly inside this packet's owned files and do not revert anyone else's
edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-ADAPTER-06.md`
- `.execution/packets/W3-PERF-02.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-claude-code-live-hardening.md` with:
- preferred session name: `codex-WORKER-claude-code-live-hardening`
- packet id: `W3-ADAPTER-07`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Current live facts:
- `claude-code` was enabled but hidden by default path precedence
- forcing `dataDir=~/.claude/projects` made `claude-code` appear immediately
- the live daemon then failed with repeated `Maximum call stack size exceeded`
  from the Claude adapter and RSS surged into the gigabytes
- do not "fix" this by weakening the runtime guard or widening into pipeline
  code unless the packet boundary proves that is necessary

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`, `src/pipeline/**`, or `src/sinks/**`
- use the real local Claude dataset as validation input if needed

Deliverables:
- default-path precedence fix
- focused path-selection tests
- platform path review
- adapter-local live hardening if possible
- durable audit artifact
- completion report in the packet format
