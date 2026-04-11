# W3-VALIDATE-01 Codex Review (2026-04-08)

## verdict

- `approved` recommended.
- No blocking findings were identified for this packet’s scoped goals.

## scope of review

- Session: `codex-REVIEWER-live-adapter-validation`
- Reviewed control-plane and packet state:
  - `.execution/program.md`
  - `.execution/blueprints.md`
  - `.execution/packets/W3-VALIDATE-01.md`
  - `.execution/packets/W3-ADAPTER-07.md`
  - `.execution/packets/W3-PERF-03.md`
  - `.execution/agents/codex-WORKER-live-adapter-validation.md`
- Reviewed packet-owned implementation and evidence:
  - `scripts/live-validation/run.ts`
  - `test/live-validation/run.test.ts`
  - `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- Reviewed in-scope blueprints:
  - `docs/blueprint/BP-02-data-flow.md`
  - `docs/blueprint/BP-04-adapter-contract.md`
  - `docs/blueprint/BP-05-store-and-migration.md`
  - `docs/blueprint/BP-10-performance-validation.md`
- Validation command executed:
  - `bun test test/live-validation/run.test.ts` (pass: 2/2)

## blocking findings

- None.

## BP Acceptance Matrix verification

- Validation uses real v2 discover/load/write path, not legacy session/message APIs (`implemented`):
  - Harness executes adapter `detect()`, `findChanged({ kind: "startup-scan" })`, `loadConversation(ref)`, then `store.writeBundle(bundle)` directly (`scripts/live-validation/run.ts:212-226`, `243-249`, `275-281`).
  - No legacy `sessions()`/`messages()` API usage appears in the harness code.

- Reconciliation inspects disposable SQLite store directly and compares to source-layer counts (`implemented`):
  - Disposable store opened at a temp path via `openStoreAtPath(storePath)` (`scripts/live-validation/run.ts:135-140`).
  - Reconciliation queries SQLite directly (`conversations`, `_jin_sync`) and computes per-conversation mismatches (`scripts/live-validation/run.ts:383-411`, `413-517`).
  - Machine-readable artifacts are written as JSON (`report.json`, `reconciliation.json`) (`scripts/live-validation/run.ts:187-192`).

- Lane stays outside frozen adapter/store/sink contract changes (`implemented` for packet scope):
  - Packet-owned implementation lives under `scripts/live-validation/**` and `test/live-validation/**` as required by the packet boundary (`docs/execution/tasks/W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md:55-60`).
  - No packet evidence required product contract edits; reviewed harness is additive and consumes existing adapter/store interfaces.

- Harness is reusable for future live-data spot checks before release (`implemented`):
  - CLI supports adapter and path overrides (`--adapters`, `--cursor-*`, `--claude-projects-dir`, `--codex-home`) (`scripts/live-validation/run.ts:743-879`).
  - Audit documents exact rerunnable commands and artifact locations (`docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md:50-58`, `89-99`).

## V1 comparison

- `no prior v1 surface` for this exact harness surface.
- The packet adds a new packet-local validator script/test lane; it does not rewrite an existing v1 command contract.

## aligned

- Harness proves the real adapter discover/load/write ingestion path and emits machine-readable reconciliation artifacts.
- Focused automated validation is present and currently passing (`bun test test/live-validation/run.test.ts`).
- Audit is explicit that live run failed overall (`report.summary.ok: false`) and does not overclaim success (`docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md:199-206`).

## drift

- Cursor live reconciliation is not clean:
  - `6` discovered refs, `6` null bundles, `0` stored conversations (`docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md:110-130`).
  - Cursor global storage DB open failure (`SQLITE_CANTOPEN`) is reproduced in audit follow-up checks (`77-79`).
- Claude Code live reconciliation is not clean:
  - `29` write-time `UNIQUE constraint failed: messages.id` failures and `29` missing store conversations (`153-155`, `141-149`).
  - `6` duplicate loaded conversation IDs remain unresolved (`138-149`).
- These are intentionally surfaced by this packet and are follow-on implementation work, not a validation-lane blocker.

## unowned spread

- No packet-owned evidence suggests this lane required edits to frozen-contract files.
- Workspace contains unrelated dirty files from other packets; this review evaluated only W3-VALIDATE-01 packet-owned artifacts and in-scope blueprint/code surfaces.

## progress

- Packet goals are met:
  - reusable harness exists,
  - disposable SQLite reconciliation exists,
  - live machine run executed across Cursor/Claude/Codex,
  - mismatches are explicit and quantified.
- `W3-VALIDATE-01` can move from `review_ready` to `approved` while follow-up fix lanes are tracked separately.

## Codex decisions needed

- Move `W3-VALIDATE-01` to `approved`.
- Open/continue follow-up implementation lanes for:
  - Cursor: global-storage DB open failure + null bundle root cause.
  - Claude Code: cross-conversation `messages.id` collision class + duplicate loaded conversation IDs.
- Keep BP-04/BP-05 scoreboard signals in `mostly_aligned` until those live-data failures are closed by packet-owned fixes.
