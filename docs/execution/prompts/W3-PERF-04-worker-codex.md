Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-claude-runtime-rss-budget`.

You are not alone in the shared canonical workspace. Other workers may still
touch nearby files. Stay strictly inside this packet's owned files and do not
revert anyone else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-04-claude-runtime-rss-budget-on-live-dataset.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-PERF-02.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-ADAPTER-10.md`
- `.execution/packets/W3-PERF-04.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-claude-runtime-rss-budget.md` with:
- preferred session name: `codex-WORKER-claude-runtime-rss-budget`
- packet id: `W3-PERF-04`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Current live facts:
- the latest local `0.8.5` service run printed `Claude Code`, `Cursor`, `Codex`,
  and `Gemini CLI`, then exited during Claude ingest with:
  `RSS 422 MB exceeded the 256 MB hard limit during ingest batch for adapter claude-code (20/921)`
- `W3-ADAPTER-07` already fixed Claude path selection and recursion/stack-overflow
  but still recorded full live Claude RSS around `812 MB`
- Cursor direct detection is currently healthy (`96` refs), so do not treat this
  as a Cursor discovery bug

Constraints:
- only edit packet-owned files
- do not touch `src/contracts/**`, `src/sinks/**`, `src/commands/service.ts`, or `src/daemon/**`
- keep the frozen BP-02 guard intact

Deliverables:
- packet-local audit
- narrow fix only if the evidence is clear and safe
- focused tests if code changes land
- completion report in the packet format
