# Review — `W3-RUNTIME-01` Recheck

- reviewer: `codex`
- session: `codex-REVIEWER-runtime-store-cutover-recheck`
- date: `2026-04-07`

## verdict

`approved` — the prior completeness blocker is resolved, and Codex can move
`W3-RUNTIME-01` to `approved`.

## scope of review

- Re-read required execution docs, packet, live control plane, prior reviews,
  and the packet-owned BP/code/tests named in the review prompt.
- Recheck scope was intentionally narrow: verify the packet-local read-surface
  evidence gap called out in `2026-04-07-W3-RUNTIME-01-codex.md`.
- Re-ran:
  - `bun test test/runtime-store-cutover.test.ts`
  - `bun test test/init.test.ts`
  - `bun test test/lifecycle-boundary.test.ts`
  - `bun test test/config-mutation-control.test.ts`

## blocking findings

No blocking findings.

- The previous row-5 blocker is closed. `analyzeCommand` now has direct
  packet-local evidence against the v2 store/query path in
  `src/commands/analyze.ts:14-45`, exercised by
  `test/runtime-store-cutover.test.ts:177-188` plus the v2 bundle seeding at
  `test/runtime-store-cutover.test.ts:231-255`.
- `statusCommand` now has direct packet-local store-stat evidence for
  `readStoreStats()` in `src/commands/status.ts:56-63,212-239`, exercised by
  `test/runtime-store-cutover.test.ts:190-200` plus the same v2 store seeding
  path at `test/runtime-store-cutover.test.ts:231-255`.
- The new evidence is packet-local and test-only. I found no new packet-owned
  product-code spread beyond the narrow evidence-gap fix; the remaining
  packet-owned code changes are the same cutover surfaces already accepted in
  the first review.

## BP Acceptance Matrix verification

- `jin start` / foreground runtime path uses the BP-02 pipeline coordinator
  instead of the v1 watcher brain
  - Implemented in `src/commands/start.ts:84-88`,
    `src/commands/watch.ts:92-128`, and `src/pipeline/loop.ts:38-125,190-220`.
  - Tested by `test/runtime-store-cutover.test.ts:108-133`.

- Live runtime writes use the BP-05 store spine in `src/db/**`, not
  `src/store.ts`
  - Implemented in `src/commands/watch.ts:92-110`,
    `src/pipeline/ingest.ts:36-140`, `src/pipeline/push.ts:19-150`, and
    `src/db/store.ts:30-115`.
  - Tested by `test/runtime-store-cutover.test.ts:108-175`.

- One-shot ingest does not bypass the single-brain invariant
  - Implemented in `src/commands/ingest.ts:12-65`.
  - Tested by `test/runtime-store-cutover.test.ts:135-175` and
    `test/init.test.ts:273-293`.

- Runtime/store cutover does not widen frozen adapter or sink contracts
  - Implemented by routing live writes through existing v2 contracts in
    `src/commands/watch.ts:113-135`, `src/commands/ingest.ts:37-65`,
    `src/pipeline/push.ts:129-150`, while leaving frozen contract files
    untouched.
  - Tested by `test/runtime-store-cutover.test.ts:125-132,171-175` and the
    rerun focused suites.

- Read surfaces touched by the cutover either migrate cleanly or are explicitly
  deferred with boundary citations
  - `status.ts` migrated in `src/commands/status.ts:56-63,212-239` and is now
    directly tested by `test/runtime-store-cutover.test.ts:190-200`.
  - `analyze.ts` migrated in `src/commands/analyze.ts:14-45` and is now
    directly tested by `test/runtime-store-cutover.test.ts:177-188`.
  - `src/tui/app.tsx:3,65-71` remains the explicit packet-owned defer onto
    `LegacyStore`, backed by `src/store.ts:765-768`.

## V1 comparison

- `watch` / live runtime parity remains intact for ownership and startup
  handling while the coordinator/store path is intentionally cut over from the
  v1 watcher/store stack to `runPipeline()` + `src/db/store.ts`
  (`src/commands/watch.ts:21-110`, `src/pipeline/loop.ts:38-188`).
- `ingest` intentionally moves from the v1 compatibility path to
  `ingestAll()` + `pushDirty()` on the v2 store while preserving the
  single-coordinator rule (`src/commands/ingest.ts:12-65`).
- `status` and `analyze` keep their operator-facing labels while now reading
  from the v2 query surface (`src/commands/status.ts:56-63,161-239`,
  `src/commands/analyze.ts:14-53`).
- `tui` remains an explicit compatibility defer, not a silent parity claim
  (`src/tui/app.tsx:3,65-71`, `src/store.ts:765-768`).

## aligned

- The live runtime and one-shot write paths still read as the real BP-02/BP-05
  cutover, not dormant v2 modules.
- The packet-local read-surface evidence gap is now closed in-scope.
- The remaining packet-owned legacy-store dependency is explicit in the TUI
  surface instead of hidden in runtime/query commands.

## drift

- No approval-blocking drift remains inside `W3-RUNTIME-01`.
- `BP-05` still stays `mostly_aligned`, not `aligned`, because
  `src/tui/app.tsx` intentionally defers to `LegacyStore` and broader
  non-packet `src/store.ts` consumers remain prior audit debt.

## unowned spread

- Broader repo `src/store.ts` compatibility surfaces outside this packet remain
  tracked by the earlier audits and were not reopened here.
- Unrelated worktree changes outside the packet/review lane were present and
  ignored.

## progress

- `bun test test/runtime-store-cutover.test.ts` passed.
- `bun test test/init.test.ts` passed.
- `bun test test/lifecycle-boundary.test.ts` passed.
- `bun test test/config-mutation-control.test.ts` passed.
- Recheck confirms the first-review blocker was completeness only; no new
  regression surfaced in the packet-owned cutover path.

## Codex decisions needed

- None for the `W3-RUNTIME-01` approval gate.
- Separate follow-up packeting is still needed if Codex wants to retire the
  explicit TUI `LegacyStore` defer or chase broader `src/store.ts` cleanup
  beyond this packet boundary.
