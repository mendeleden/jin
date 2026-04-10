# Review: W3-PRODUCT-01 — Command Surface Reframe

- reviewer: `claude-REVIEWER-w3-product`
- packet: `W3-PRODUCT-01`
- date: `2026-04-05`

## verdict

`approved` — Codex can move `W3-PRODUCT-01` to `approved`.

## scope of review

Audited against:

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- `docs/execution/05-live-control-plane.md`
- `docs/execution/tasks/W3-PRODUCT-01-command-surface-reframe.md`
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `.execution/packets/W3-MODULE-01.md`
- `.execution/reviews/2026-04-04-W3-MODULE-01-cursor.md`
- `docs/blueprint/BP-Product-Strategy.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/index.ts`
- `src/api/routes.ts`
- `src/store.ts`
- `src/adapters/types.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- `src/commands/team-config.ts`
- `src/commands/watch.ts`
- `src/commands/ingest.ts`
- `src/commands/benchmark.ts`
- `src/commands/sink.ts`
- `test/connect.test.ts`
- `test/init.test.ts`
- `test/config-mutation-control.test.ts`
- `test/local-control-boundary.test.ts`
- `test/read-only-query-surface.test.ts`

Focused verification rerun:

- `bun test test/connect.test.ts test/init.test.ts test/config-mutation-control.test.ts test/read-only-query-surface.test.ts test/local-control-boundary.test.ts`
- `bun src/index.ts --help`
- `bun src/index.ts help sink`
- `bun src/index.ts help connect`
- `bun src/index.ts help show`

All 45 focused tests passed.

## blocking findings

None. No blocking findings in this re-review.

- The retained `jin init` bridge is now explicitly accounted for as a defer, and its write-capable ingest path now respects the single-coordinator rule (`.execution/packets/W3-PRODUCT-01.md:60-61`; `src/commands/init.ts:65-84`; `src/commands/ingest.ts:15-25`; `test/init.test.ts:213-233`).
- The legacy `connect --directory` bridge is removed from help, CLI dispatch, implementation, and focused regression coverage (`src/index.ts:116-140`, `src/index.ts:415-438`; `src/commands/connect.ts:27-47`, `src/commands/connect.ts:559-600`; `test/connect.test.ts:216-227`).
- `watchCommand()` no longer mutates durable config during daemon startup and now behaves like a startup snapshot within this packet scope (`src/commands/watch.ts:63-66`, `src/commands/watch.ts:107-124`; `test/config-mutation-control.test.ts:311-333`).

## BP Acceptance Matrix verification

- `BP-Product: daemon-first local-first onboarding is the primary story`: verified. Top-level help now puts `start` under `Local-first`, demotes `init` into `Compatibility / Admin`, and `help init` points back to `jin start` as the primary path (`src/index.ts:201-222`, `src/index.ts:304-343`; verified by `bun src/index.ts --help`). `team-config` prints the same order and keeps low-level sink/route wiring separate (`src/commands/team-config.ts:65-85`).
- `BP-07 / BP-08: write-capable one-shot compatibility ingest respects the single-coordinator rule`: verified. `ingestCommand()` fails fast while a long-lived runtime owns the store (`src/commands/ingest.ts:15-25`), and `initCommand()` skips compatibility ingest in that state instead of running a second coordinator (`src/commands/init.ts:65-84`; `test/init.test.ts:213-233`).
- `BP-07 first-run rule ("jin start" is the only bootstrap path; no separate init command)`: verified as deferred, not omitted. The packet matrix now records the retained `jin init` bridge explicitly (`.execution/packets/W3-PRODUCT-01.md:60-61`), while the command/help surface consistently points primary onboarding to `jin start` (`src/index.ts:212-217`, `src/index.ts:341`; `src/commands/team-config.ts:70-80`).
- `BP-Product / BP-08: Team/workspace framing stays separate from generic sink wiring`: verified. Usage splits `Workspace` from `Integrations` (`src/index.ts:318-330`), interactive `jin connect` only routes repos onto existing destinations and sends generic setup to `jin sink add ...` / `jin route add ...` (`src/commands/connect.ts:203-210`, `src/commands/connect.ts:238-259`), and focused tests confirm team metadata stays out of durable generic config (`test/config-mutation-control.test.ts:249-309`).
- `BP-Product / BP-08: generic integrations stay available without becoming the product story`: verified. `jin sink ...` and `jin route ...` are first-class top-level surfaces (`src/index.ts:255-280`, `src/index.ts:325-330`; verified by `bun src/index.ts help sink`), while `connect` explicitly demotes the legacy shortcut flags as compatibility (`src/commands/connect.ts:71-117`).
- `BP-08: removed v1 directory-based repo routing from the command surface`: verified. `help connect` no longer advertises `--directory` (`src/index.ts:116-140`; verified by `bun src/index.ts help connect`), CLI dispatch no longer forwards it (`src/index.ts:415-438`), `connect` now routes only by remote or indexed repo identity (`src/commands/connect.ts:559-600`), and focused regression coverage asserts the bridge is unsupported (`test/connect.test.ts:216-227`).
- `BP-Product / BP-07: canonical local read surfaces can speak in conversation-first terms without breaking clients`: verified. The CLI exposes `conversations` / `show` in conversation-first language (`src/index.ts:68-99`, `src/index.ts:304-316`; verified by `bun src/index.ts help show`), and the API exposes `/api/conversations` plus `/api/projects/:id/conversations` while retaining `/api/sessions*` aliases (`src/api/routes.ts:80-170`, `src/api/routes.ts:195-208`). Focused regression coverage hits both the canonical and compatibility paths (`test/read-only-query-surface.test.ts:116-150`).
- `BP-07 / BP-08: legacy one-shot/watch/benchmark compatibility commands operate against the BP-08 config shape without reviving a store config block`: verified within the explicit legacy-store defer. `ingest`, `watch`, and `benchmark` all resolve the store path through daemon runtime-state rather than a revived `config.store.dbPath` contract (`src/commands/ingest.ts:27-30`; `src/commands/watch.ts:63-66`; `src/commands/benchmark.ts:252-255`), and `LegacyStore` is explicitly marked as a compatibility bridge (`src/store.ts:765-768`). Focused tests for `init` and config mutation still pass.
- `BP-07 / BP-08: daemon startup treats config as a startup snapshot within this command surface`: verified. `watchCommand()` now loads config once, only considers already-enabled adapters, and exits cleanly instead of auto-enabling adapters or rewriting config (`src/commands/watch.ts:63-66`, `src/commands/watch.ts:107-124`; `test/config-mutation-control.test.ts:311-333`).
- `BP-04 / BP-06: remove legacy adapter sessions() / messages() compatibility surface`: verified as deferred. `src/adapters/types.ts` now names the retained bridge explicitly as `LegacyAdapter`, `LegacySession`, and `LegacyMessage` (`src/adapters/types.ts:1-81`).
- `BP-05 / BP-07: remove the remaining legacy local store bridge`: verified as deferred. `src/store.ts` explicitly exports `LegacyStore` as the compatibility bridge for the remaining admin/compatibility commands (`src/store.ts:765-768`).
- `BP-Product / BP-07: remove session-like API aliases and payload duplicates entirely`: verified as deferred. `src/api/routes.ts` still keeps `/api/sessions*`, `session` wrappers, duplicate field spellings, and empty `tags` / `artifacts` stubs (`src/api/routes.ts:65-77`, `src/api/routes.ts:80-170`, `src/api/routes.ts:210-223`, `src/api/routes.ts:240-303`), and the packet now treats that as an explicit compatibility carryover rather than an undeclared mismatch.

## V1 comparison

All current V1 Comparison claims are accurate as written.

- The primary-path claim is now accurate because the packet no longer presents `jin init` as BP-07-complete behavior; it explicitly keeps `init` as a compatibility helper while the help surface points to `jin start`, and the active-runtime ingest caveat is implemented in code (`src/index.ts:201-222`, `src/index.ts:304-343`; `src/commands/init.ts:65-84`; `src/commands/ingest.ts:15-25`).
- The generic-integration reframing claim is accurate. `jin sink ...` and `jin route ...` are visible top-level commands, while `connect --postgres|--s3|--webhook` remains only as a demoted compatibility shortcut (`src/index.ts:255-280`, `src/index.ts:325-330`; `src/commands/connect.ts:71-117`).
- The guided-connect claim is accurate. Interactive `jin connect` now only offers existing destinations and does not create new generic sinks inline (`src/commands/connect.ts:198-259`).
- The directory-routing removal claim is accurate. The help surface, dispatch layer, implementation, and focused test suite all agree that the old `--directory` bridge is gone (`src/index.ts:116-140`, `src/index.ts:415-438`; `src/commands/connect.ts:559-600`; `test/connect.test.ts:216-227`).
- The conversation-first alias claim is accurate. Canonical conversation endpoints and commands exist, while the legacy session aliases remain intact for compatibility (`src/index.ts:68-99`; `src/api/routes.ts:80-170`, `src/api/routes.ts:195-208`; `test/read-only-query-surface.test.ts:116-150`).
- Both parity claims are accurate. `connect` / `disconnect` still preserve the same remote-based route add/remove behavior and sink reuse semantics (`src/commands/connect.ts:118-134`, `src/commands/connect.ts:338-430`; `test/connect.test.ts:87-205`, `test/connect.test.ts:242-306`), and `init --team` still writes plain generic sink config without leaking workspace metadata (`src/commands/init.ts:15-40`, `src/commands/init.ts:96-107`; `test/config-mutation-control.test.ts:278-309`).
- The watch-startup claim is accurate. Startup no longer auto-enables adapters or persists config changes during daemon launch (`src/commands/watch.ts:107-124`; `test/config-mutation-control.test.ts:311-333`).

## aligned

- The command/help surface now tells a coherent daemon-first, local-first product story, with `jin start` as the clear primary path and `init` visibly demoted into compatibility/admin help (`src/index.ts:201-222`, `src/index.ts:304-343`).
- Workspace onboarding remains distinct from generic integration wiring. `team-config` and `connect --team` frame workspace setup, while `sink` / `route` remain the explicit low-level BYO integration surface (`src/commands/team-config.ts:65-85`; `src/commands/connect.ts:92-107`, `src/commands/connect.ts:203-210`).
- Generic integrations remain available without becoming the product story. The compatibility sink shortcuts are still present, but they are now clearly labeled as legacy bridges instead of being the main onboarding narrative (`src/commands/connect.ts:71-117`).
- The retained bridges are now explicitly justified in packet notes, the BP Acceptance Matrix, and the V1 Comparison rather than being silently widened product behavior (`.execution/packets/W3-PRODUCT-01.md:46-81`).

## drift

- `jin init` still exists, so BP-07/BP-08 first-run ideal is not fully realized yet; that difference is now an explicit compatibility defer rather than a missing packet requirement (`src/index.ts:201-222`, `src/index.ts:404-410`; `src/commands/init.ts:10-154`).
- `connect --postgres|--s3|--webhook` remains a compatibility shortcut surface on top of the new `sink` / `route` commands (`src/commands/connect.ts:71-117`).
- The read API still carries session-like aliases and payload duplication for existing clients (`src/api/routes.ts:65-77`, `src/api/routes.ts:80-170`, `src/api/routes.ts:240-303`).
- The legacy-store / legacy-adapter bridges remain underneath the remaining compatibility commands (`src/store.ts:765-768`; `src/adapters/types.ts:1-81`).
- `team-config` still serializes onboarding through a sink-shaped compatibility payload (`src/commands/team-config.ts:43-63`). The framing is correct now, but the bridge remains broader than the eventual BP-08 endpoint/config cleanup.

## unowned spread

None within packet scope. The untracked `docs/brainstorms/` note remains unrelated to this review lane.

## progress

- All three 2026-04-04 blockers are resolved in code, tests, and packet accounting.
- The BP Acceptance Matrix now matches the real command/help/API behavior row by row, including the intentional defers.
- The product story is now daemon-first, local-first, with workspace onboarding separated from generic integration wiring and generic integrations still available as a lower-level surface.

## Codex decisions needed

1. Move `W3-PRODUCT-01` to `approved`.
2. Decide separately whether the remaining explicit compatibility bridges (`jin init`, sink shortcut flags, `LegacyStore`, `LegacyAdapter`, session-like API aliases, onboarding payload shape) should be narrowed in follow-up hardening packets. They are no longer blockers for this packet.
