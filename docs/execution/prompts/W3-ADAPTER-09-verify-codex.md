Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-VERIFIER-claude-code-id-collision`.

This is a verification-only lane. Do not edit product code. You may write only:

- `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-cli-verification.md`
- `.execution/agents/codex-VERIFIER-claude-code-id-collision.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`

Then read the packet evidence:

- `.execution/program.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/agents/codex-WORKER-claude-code-id-collision.md`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- `scripts/live-validation/run.ts`

Then run an independent verification pass using Claude CLI as external instrumentation.

Use this exact command shape and capture the stream log:

```sh
claude -p --verbose --output-format stream-json \
  -n claude-VERIFIER-claude-code-id-collision \
  --permission-mode auto \
  "$(cat docs/execution/prompts/W3-ADAPTER-09-verify-claude.md)" \
  >> .execution/logs/claude-VERIFIER-claude-code-id-collision.stream.jsonl 2>&1
```

Goals for the independent verification pass:

- confirm the scoped conversation/message ID fix is coherent against the live packet evidence
- independently re-check compaction and spawned/sub-agent behavior
- independently re-run the read-only duplicate-ID and message-collision probes when useful
- independently decide whether the worker evidence is strong enough to approve `W3-ADAPTER-09`

After the Claude CLI pass completes, write:

- `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-cli-verification.md`

The audit must include:

- verdict
- exact commands run
- whether Claude independently agreed or disagreed with the worker result
- whether compaction and sub-agent cases look covered
- any blockers or residual follow-ups

Important:

- keep updating `.execution/agents/codex-VERIFIER-claude-code-id-collision.md` as you go
- do not edit `.execution/program.md`, `.execution/packets/*.md`, or product code
- if the Claude CLI run hits a permission or runtime gate, record the exact failure and stop
