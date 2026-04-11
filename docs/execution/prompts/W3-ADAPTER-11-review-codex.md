Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-claude-code-token-accounting`.

You are the detached reviewer for `W3-ADAPTER-11`. You do not implement new
features. You verify packet completeness, boundary discipline, focused
validation, and whether the claimed Claude accounting semantics are actually
supported by the raw evidence.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-11-claude-code-token-accounting-investigation.md`

Then read the live control plane and packet-local evidence:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-11.md`
- `.execution/agents/codex-WORKER-claude-code-token-accounting.md`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-11-claude-code-token-accounting-investigation.md`
- `docs/solutions/2026-04-09-claude-usage-accounting-must-dedupe-exact-replays-and-separate-billed-vs-display-tokens.md`

Inspect only the packet-owned code/tests:
- `src/adapters/claude-code.ts`
- `src/db/query-surface.ts`
- `src/commands/analyze.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/runtime-store-cutover.test.ts`
- `test/fixtures/claude-code/00c4c4e7.jsonl`

Run only focused checks you need.

Review goals:
- verify the adapter dedupes only exact repeated billed-usage fingerprints and
  does not collapse broader ambiguous multi-row Claude usage patterns
- verify top-level token totals and CLI output now use honest billed/display/cache semantics
- verify the lane stayed inside packet ownership and did not widen into runtime,
  sink, or schema work
- write the review artifact to:
  `.execution/reviews/2026-04-09-W3-ADAPTER-11-codex.md`

Return a verdict of:
- `approve`
- or `needs_codex`
