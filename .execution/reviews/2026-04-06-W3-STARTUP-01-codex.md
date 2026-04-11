# Review: W3-STARTUP-01 — Protected Source Opt-In

- reviewer: `codex-REVIEWER-protected-source-opt-in`
- packet: `W3-STARTUP-01`
- date: `2026-04-06`

## verdict

`approved` — Codex can move `W3-STARTUP-01` to `approved`.

## scope of review

Audited against:

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- `docs/execution/05-live-control-plane.md`
- `docs/execution/tasks/W3-STARTUP-01-protected-source-opt-in.md`
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/agents/codex-WORKER-protected-source-opt-in.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `.execution/reviews/2026-04-04-W3-PRODUCT-01-claude.md`
- `docs/execution/04-frozen-contract-surface.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/config.ts`
- `src/adapters/registry.ts`
- `src/adapters/cursor.ts`
- `src/adapters/kiro.ts`
- `src/adapters/opencode.ts`
- `src/adapters/warp.ts`
- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/init.ts`
- `test/startup-protected-source-opt-in.test.ts`
- `test/config-mutation-control.test.ts`
- `test/init.test.ts`
- `test/cursor-adapter.test.ts`

Focused verification rerun:

- `bun test test/startup-protected-source-opt-in.test.ts test/config-mutation-control.test.ts test/init.test.ts test/cursor-adapter.test.ts`

All 30 focused tests passed.

## blocking findings

None. No blocking findings in this packet review.

## BP Acceptance Matrix verification

- `Startup does not probe protected or app-private adapter sources unless the adapter is explicitly enabled/opted in for that OS`: verified. `defaultConfig()` now defaults `cursor`, `kiro`, `opencode`, and `warp` to `allowProtectedSource: false` (`src/config.ts:145-173`, `src/config.ts:191-242`). `watchCommand()` and `initCommand()` both build adapters from the snapshotted config, skip disabled adapters, and stop on `startupProbeBlocked()` before `detect()` runs (`src/commands/watch.ts:67-133`, `src/commands/init.ts:53-77`). The registry enforces opt-in-only behavior for `kiro`, `opencode`, and `warp`, while Cursor stays mixed-default by blanking its protected `globalStorage` probe until explicit opt-in (`src/adapters/registry.ts:28-126`, `src/adapters/registry.ts:175-227`). Verified by `test/startup-protected-source-opt-in.test.ts:8-67`, `test/config-mutation-control.test.ts:341-364`, and `test/init.test.ts:241-358`.
- `Daemon startup does not auto-enable previously disabled adapters or write discovery results back into durable config`: verified for the daemon path. `startCommand()` delegates the primary runtime bootstrap to `watchCommand()` (`src/commands/start.ts:66-88`), and `watchCommand()` now only reads the snapshotted config, filters on `enabled` plus `startupProbeBlocked()`, and never writes adapter detection results back to config (`src/commands/watch.ts:67-133`). Verified by `test/config-mutation-control.test.ts:317-364`.
- `macOS paths under ~/Library/Application Support/** that trigger TCC/privacy prompts are classified as opt-in-only startup sources`: verified. Startup policy text now names the protected macOS roots for Cursor, Kiro, OpenCode, and Warp (`src/adapters/registry.ts:28-72`), while the adapter defaults still place those protected roots behind the new gating layer (`src/adapters/cursor.ts:91-102`, `src/adapters/cursor.ts:863-887`, `src/adapters/kiro.ts:43-85`, `src/adapters/opencode.ts:31-55`, `src/adapters/warp.ts:36-89`). Verified by `test/startup-protected-source-opt-in.test.ts:18-32`, `test/config-mutation-control.test.ts:341-364`, and `test/init.test.ts:241-275`.
- `Linux and Windows adapter discovery behavior is explicitly classified by path class instead of relying on silent probing`: verified. The registry now publishes per-platform startup notices instead of silently probing protected roots (`src/adapters/registry.ts:28-72`, `src/adapters/registry.ts:154-172`), and both reviewed startup surfaces emit those notices to users (`src/commands/watch.ts:126-133`, `src/commands/watch.ts:297-311`, `src/commands/init.ts:57-58`, `src/commands/init.ts:121-151`). Verified by `test/startup-protected-source-opt-in.test.ts:34-48` and `test/init.test.ts:277-285`.
- `User-provided adapter data paths remain allowed without widening frozen adapter contracts`: verified within the allowed shim boundary. The frozen contract surface remains untouched, and `src/config.ts` is still the compatibility shim where adapter config can be extended (`docs/execution/04-frozen-contract-surface.md:39-57`). `allowProtectedSource` and `dataDir` now act as explicit opt-in signals without reopening `src/contracts/**` (`src/config.ts:55-57`, `src/config.ts:158-173`, `src/adapters/registry.ts:80-134`, `src/adapters/registry.ts:218-227`). Focused coverage verifies both opt-in forms at the startup surface (`test/startup-protected-source-opt-in.test.ts:51-67`, `test/init.test.ts:287-358`), and the Cursor adapter still supports explicit path injection (`test/cursor-adapter.test.ts:25-32`, `test/cursor-adapter.test.ts:225-226`).

## V1 comparison

- intentional BP-backed change: startup no longer probes every adapter source by default. The reviewed diff replaces unconditional detection with config-gated factory construction plus `startupProbeBlocked()` filtering, and Cursor now auto-detects only `.cursor/chats` until the protected `globalStorage` DB is explicitly opted in (`src/adapters/registry.ts:28-126`, `src/commands/watch.ts:112-133`, `src/commands/init.ts:53-77`; verified by `test/startup-protected-source-opt-in.test.ts:18-67` and `test/init.test.ts:241-358`).
- intentional BP-backed change: daemon startup no longer auto-enables or auto-disables adapters based on discovery. `watchCommand()` now consumes config as a snapshot and never persists discovery results, and `initCommand()` no longer writes per-adapter detection outcomes back into `config.adapters` before saving (`src/commands/watch.ts:67-133`, `src/commands/init.ts:53-80`; verified by `test/config-mutation-control.test.ts:317-364` and `test/init.test.ts:241-358`).

## aligned

- The reviewed startup path now matches BP-07 snapshot semantics: config is loaded once per run, disabled adapters stay disabled, and protected/app-private sources require explicit opt-in before `detect()` executes (`docs/blueprint/BP-07-process-lifecycle.md:261-275`; `src/commands/watch.ts:67-133`).
- The packet keeps BP-04 and the frozen contract surface intact by implementing policy in allowed shims only: `src/config.ts`, `src/adapters/registry.ts`, and startup command surfaces, without reopening `src/contracts/**` (`docs/execution/04-frozen-contract-surface.md:39-57`).
- Operator-visible wording exists in both JSON and human output, so the stricter startup policy is not silent (`src/commands/init.ts:113-151`, `src/commands/watch.ts:297-311`).

## drift

- `jin init` still persists normalized config via `saveConfig(config)` at `src/commands/init.ts:80`. The packet removed discovery-driven enable/disable writeback, but "startup writes no config" is fully true only for the primary daemon path `jin start` -> `watchCommand()`, not for this retained compatibility helper.
- The existing Wave 3 product defer remains unchanged: `jin init` is still a compatibility command rather than BP-07's final first-run surface. This packet hardens its detection behavior but does not close that broader product-surface gap.

## unowned spread

None within packet scope. The reviewed implementation stays inside the packet-owned files listed in the worker heartbeat and task packet.

## progress

- The packet goals are implemented on the reviewed startup paths: protected/app-private sources are gated behind explicit opt-in, disabled adapters stay disabled, and daemon startup no longer rewrites durable config from discovery.
- The BP Acceptance Matrix is complete and the five in-scope rows verify against code plus focused test citations.
- The packet-local verification suite reran cleanly in this review lane: 30/30 tests passed.

## Codex decisions needed

1. Move `W3-STARTUP-01` to `approved`.
2. Decide separately whether the retained `jin init` compatibility save at `src/commands/init.ts:80` should be narrowed in a later cleanup packet if you want "startup writes no config" to apply beyond daemon startup.
