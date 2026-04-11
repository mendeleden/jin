# verdict

Approved. No blocking findings.

# scope of review

- execution docs and packet task:
  - `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`
- live control plane context:
  - `.execution/program.md`
  - `.execution/blueprints.md`
  - `.execution/packets/W3-ADAPTER-07.md`
  - `.execution/packets/W3-VALIDATE-01.md`
  - `.execution/agents/codex-WORKER-claude-code-live-hardening.md`
  - `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
  - `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
  - `docs/solutions/2026-04-08-adapter-default-path-selection-must-prefer-populated-sources.md`
- packet-owned BP/code/tests:
  - `docs/blueprint/BP-02-data-flow.md`
  - `docs/blueprint/BP-04-adapter-contract.md`
  - `src/adapters/claude-code.ts`
  - `test/claude-code-reference-adapter.test.ts`
  - `test/integration.test.ts`
- focused verification rerun:
  - `bun test test/claude-code-reference-adapter.test.ts`

# blocking findings

No blocking findings.

# BP Acceptance Matrix verification

- `Default path selection prefers a populated source or user override over an empty preferred directory` -> implemented in `src/adapters/claude-code.ts:152-228`, which now prefers the first candidate containing `.jsonl` source before falling back to mere existence; covered by `test/claude-code-reference-adapter.test.ts:21-141` for macOS, Linux, Windows, and explicit override precedence.
- `Platform path rules are explicit and reviewed for macOS/Linux/Windows` -> implemented in `src/adapters/claude-code.ts:186-228`; packet-local tests cover darwin/linux populated-precedence and Windows `%APPDATA%` versus legacy fallback in `test/claude-code-reference-adapter.test.ts:21-112`, and the packet audit records the resulting platform rules in `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md:97-101`.
- `The live Claude dataset no longer stack-overflows or explodes RSS if the fix remains adapter-local` -> implemented for the stack-overflow / recursion failure in `src/adapters/claude-code.ts:1181-1268` and `src/adapters/claude-code.ts:1290-1334`, where subagent files derive child identity from `agentId`, parent resolution cannot resolve a child back to itself, and missing parent transcripts degrade to a spawned-link fallback; covered by `test/claude-code-reference-adapter.test.ts:143-180` and `test/claude-code-reference-adapter.test.ts:311-353`, plus the live audit in `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md:36-64`. The remaining `812 MB` live full-dataset pressure is explicitly documented as out-of-scope for this adapter-local lane in `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md:84-105`, not overclaimed as fixed.
- `The lane does not widen frozen pipeline/store/sink contracts` -> implemented by scope. Product changes are confined to `src/adapters/claude-code.ts` and focused tests/audits. No pipeline, store, sink, or contract files changed; the packet audit states that directly in `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md:103-105`.

# V1 comparison

- Intentional change: default Claude path selection now prefers populated real sources over empty preferred directories, instead of the old “first existing path wins” behavior.
- Intentional change: real subagent files now identify the child conversation with `agentId` and avoid self-recursing parent resolution.
- Parity kept: the adapter still returns the same v2 `ConversationBundle` shape and remains entirely inside the adapter boundary; no pipeline/store/sink contract widening was introduced.
- Deferred: full live-dataset RSS remains above the BP-02 limit under the frozen full-bundle path and is correctly handed off as a broader perf/contract follow-up rather than resolved here.

# aligned

- `BP-04` is satisfied for this lane: discovery path selection now prefers populated real sources, and live child identity / parent resolution behavior matches the intended adapter semantics (`src/adapters/claude-code.ts:152-228`, `src/adapters/claude-code.ts:1181-1334`).
- `BP-02` boundary discipline is preserved: the lane fixes the adapter-local recursion failure without widening pipeline/store behavior, and it accurately leaves the remaining `812 MB` full-dataset pressure to the broader runtime/perf lanes.

# drift

- No packet-blocking drift remains.
- Informational only: the Windows compatibility third fallback (`%USERPROFILE%\\.config\\claude\\projects`) is explicit in code but not directly fixture-tested; this is acceptable for this lane because the primary precedence bug and Windows legacy/appdata ordering are covered.

# unowned spread

- `W3-VALIDATE-01` still reports live Claude write-time issues outside this packet:
  - duplicate loaded conversation IDs
  - `UNIQUE constraint failed: messages.id`
  - missing store conversations after load/write reconciliation
  These are not caused by the path-precedence or recursion bug fixed here and should stay with the live validation / follow-on adapter lanes.
- The remaining `~812 MB` full-dataset pressure is also outside this packet’s safe adapter-local boundary and belongs with the runtime/perf/contract follow-up work.

# progress

- The lane closes the two concrete failures it set out to fix:
  - empty preferred directory shadowing a populated real Claude dataset
  - live child-recursion / stack-overflow on real subagent transcripts
- Focused verification rerun passed: `12` tests in `test/claude-code-reference-adapter.test.ts`.
- The packet-owned live audit is candid about what is fixed and what is not.

# Codex decisions needed

- Move `W3-ADAPTER-07` to `approved`.
- Keep the remaining `~812 MB` live full-dataset pressure in the broader perf/contract track instead of reopening this packet.
