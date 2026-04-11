# verdict

- `approved`
- No blocking findings. Codex can move `W3-RECOVERY-01` to `approved`.

# scope of review

- Read, in the requested order:
  - `docs/execution/00-global-rules.md`
  - `docs/execution/01-dispatch-protocol.md`
  - `docs/execution/05-live-control-plane.md`
  - `docs/execution/tasks/W3-RECOVERY-01-poisoned-local-store-reset-guidance.md`
- Read the live control plane and packet context:
  - `.execution/program.md`
  - `.execution/blueprints.md`
  - `.execution/packets/W3-RECOVERY-01.md`
  - `.execution/packets/W3-E2E-01.md`
  - `.execution/agents/codex-WORKER-poisoned-local-store-recovery.md`
  - `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
  - `docs/execution/experimental-v2-reset-and-install.md`
- Reviewed only the packet-owned BP/code/tests named in the prompt:
  - `docs/blueprint/BP-05-store-and-migration.md`
  - `docs/blueprint/BP-07-process-lifecycle.md`
  - `src/db/store.ts`
  - `src/commands/start.ts`
  - `src/commands/ingest.ts`
  - `test/poisoned-local-store-recovery.test.ts`
  - `test/runtime-store-cutover.test.ts`
  - `test/db-store-spine.test.ts`
- Verified the packet-owned diff and reran:
  - `bun test test/poisoned-local-store-recovery.test.ts test/runtime-store-cutover.test.ts test/db-store-spine.test.ts`

# blocking findings

- None. No blocking findings in the packet-owned recovery diff.

# BP Acceptance Matrix verification

- `Experimental v2 local-store recovery behavior is explicit and actionable` -> implemented in `src/db/store.ts:136-159`, `src/commands/start.ts:95-100`, and `src/commands/ingest.ts:68-72`; tested by `test/poisoned-local-store-recovery.test.ts:112-143`.
- `Lifecycle commands surface actionable next steps instead of raw low-level errors` -> implemented in `src/commands/start.ts:95-100` and `src/commands/ingest.ts:68-72`; tested by `test/poisoned-local-store-recovery.test.ts:118-142`, which asserts the reset guidance is printed and the raw `SQLiteError` text is not.
- `The packet does not silently delete local state or introduce automatic repair magic` -> implemented by guidance-only behavior in `src/db/store.ts:149-159`; the aligned runbook explicitly keeps reset manual in `docs/execution/experimental-v2-reset-and-install.md:16-26` and `docs/execution/experimental-v2-reset-and-install.md:68-83`. No destructive reset code path was added in the packet-owned diff.
- `Reset guidance stays aligned with the runbook in docs/execution/experimental-v2-reset-and-install.md` -> runtime copy in `src/db/store.ts:149-152` matches the runbook text in `docs/execution/experimental-v2-reset-and-install.md:19-25`; exercised by `test/poisoned-local-store-recovery.test.ts:118-142`.

# V1 comparison

- `no prior v1 surface`
- This packet adds an experimental v2 recovery message for a packet-defined failure signature. I did not find a prior v1 recovery contract that this change rewrites.

# aligned

- The poisoned-store signature is centralized in `src/db/store.ts:136-143` and limited to the packet-defined `READONLY` / `CANTOPEN` family instead of widening into migration or repair behavior.
- `jin start` now converts poisoned-store startup failures into the explicit reset guidance at `src/commands/start.ts:95-100`.
- `jin ingest` does the same for one-shot ingest at `src/commands/ingest.ts:68-72`.
- The runtime copy and runbook copy are aligned: `src/db/store.ts:149-152` and `docs/execution/experimental-v2-reset-and-install.md:19-25`.
- Focused verification passed: `13` tests, `0` failures across `test/poisoned-local-store-recovery.test.ts`, `test/runtime-store-cutover.test.ts`, and `test/db-store-spine.test.ts`.

# drift

- No new BP-05 or BP-07 drift was introduced by this packet.
- `BP-05` still remains `mostly_aligned` for already-tracked reasons outside this packet, especially the explicit `LegacyStore` defer noted in the control plane.
- `BP-07` still remains `mostly_aligned` for already-tracked lifecycle/product gaps outside this packet; this recovery lane does not widen them.

# unowned spread

- The packet-owned recovery change itself stays inside the intended boundary: `src/db/store.ts`, `src/commands/start.ts`, `src/commands/ingest.ts`, `docs/execution/experimental-v2-reset-and-install.md`, and `test/poisoned-local-store-recovery.test.ts`.
- The workspace also contains unrelated concurrent changes outside this packet, including `src/adapters/codex.ts`, `src/pipeline/ingest.ts`, and `test/pipeline-spec-gap-closure.test.ts`. I did not review those here, and they should not be folded into `W3-RECOVERY-01` when Codex lands this packet.

# progress

- The worker heartbeat claim is materially correct: the recovery behavior now maps the poisoned-store signatures to explicit manual reset guidance instead of raw SQLite failures, and the runbook is aligned.
- The packet-owned artifacts are currently split across staged, unstaged, and untracked workspace state, so Codex should collect only the recovery-owned files when landing the packet.

# Codex decisions needed

- None for the approval gate.
- Codex can move `W3-RECOVERY-01` to `approved`.
