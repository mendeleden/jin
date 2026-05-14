# W4-CONFIG-01 - Daemon Config Reload Control Boundary

Status: review_ready
Owner: worker
Branch: fix/config-mutation-boundary-19

## Role

Implement the first-party config mutation apply path through the daemon's local control boundary.

## Goal

When a Jin command mutates `config.json`, the command must persist the config durably, then ask the already-running daemon to reload through the daemon-owned local API/socket control plane. File watching remains a fallback for manual edits and third-party writers, not the primary command-to-runtime synchronization path.

## Depends On

- `docs/ontology.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- Current branch reload pipeline work in `src/commands/watch.ts` and `src/pipeline/**`
- Desktop daemon-query direction from PR 55: one daemon-owned local boundary, Desktop and CLI as clients

## Unblocks

- Immediate config apply semantics for `jin connect`, `jin sink`, and `jin route`
- Desktop-safe runtime control without starting a second runtime
- W4-CONFIG-02 status/queue observability

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/ontology.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `src/commands/config-control.ts`
8. `src/commands/watch.ts`
9. `src/api/control.ts`
10. `src/api/routes.ts`
11. `src/api/server.ts`
12. `test/config-mutation-control.test.ts`
13. `test/local-control-boundary.test.ts`

## Owned Files

- `src/api/control.ts`
- `src/api/routes.ts`
- `src/api/server.ts`
- `src/api/client.ts` if a shared local API client is introduced
- `src/commands/config-control.ts`
- `src/commands/sink.ts`
- `src/commands/watch.ts`
- `src/config.ts`
- `src/index.ts`
- `src/pipeline/types.ts`
- `src/pipeline/loop.ts`
- `src/pipeline/push.ts`
- `test/config.test.ts`
- `test/config-mutation-control.test.ts`
- `test/local-control-boundary.test.ts`
- `test/pipeline-spine.test.ts`
- A new focused test file under `test/` if needed
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/blueprint/mermaid/bp-08-config-mutation-and-runtime-control.mmd`

## Forbidden Boundaries

- Do not change Desktop renderer or UI code.
- Do not change adapter ingestion semantics.
- Do not change sink write schemas or routing rules.
- Do not modify unrelated ingestion, adapter, or sink payload semantics.
- Do not add a second runtime, hidden worker, or process-local shortcut that bypasses the daemon boundary.
- Do not make file watching the only supported command apply path.

## Required Design

- Add a daemon-local control route for config reload, for example `POST /api/control/config/reload`.
- The route must require the same local daemon authentication as existing control/status routes.
- The route must enqueue the existing coordinator-owned config reload path and return an acknowledgement.
- First-party config-mutating commands should call this route after durable config write when a daemon is running.
- If the daemon is not running, the command should keep current "applies on next start" behavior.
- If the daemon notification fails but the daemon is expected to be running, the command must surface a clear warning and rely on the file watcher fallback rather than silently claiming success.
- `fs.watch(config.json)` remains as a fallback for manual edits, MDM/profile writes, old clients, and recovery.

## Acceptance Checks

- `bun run typecheck`
- `bun test test/config-mutation-control.test.ts test/local-control-boundary.test.ts`
- A focused test proving the command path calls the daemon reload route or injected equivalent after a config mutation.
- A focused test proving unauthenticated reload requests are rejected at the local API boundary.
- A focused test proving daemon-unavailable behavior does not corrupt config and reports next-start or fallback semantics.

## BP Acceptance Matrix

| BP | Requirement | Evidence |
| --- | --- | --- |
| BP-07 | Desktop and CLI use the daemon as the single local runtime authority. | Reload is exposed through daemon local API/socket, not through repo-local Bun or an in-command runtime. |
| BP-07 | Local control surfaces are authenticated and transport-owned. | Reload route uses existing local auth and transport behavior. |
| BP-08 | Config mutation commands persist durable config first. | Commands still use `updateConfig` / `saveConfig` before daemon notification. |
| BP-08 | Runtime config changes are applied by the coordinator pipeline. | Reload route delegates to `PipelineHandle.reloadConfig` / coordinator work item. |
| BP-08 | Manual config edits remain supported. | File watcher fallback remains and is covered by tests or explicit non-regression. |

## V1 Comparison

V1-era behavior relied on restart expectations and ad hoc command-side assumptions. This packet intentionally replaces that with a daemon-owned reload request. The compatibility contract is user-facing behavior, not internal implementation: config commands must remain safe, durable, and understandable. Existing v1-only shortcuts or dead restart assumptions should not be preserved.

## Stop And Escalate

Stop before implementation if the daemon local API cannot safely distinguish an accepted reload request from a completed reload. That may require W4-CONFIG-02 status work to land first or a narrowed response contract.

## Completion Report

Report changed files, acceptance checks, BP matrix result, V1 comparison, and any follow-up required for W4-CONFIG-02.

## Current Result

- Implemented authenticated `POST /api/control/config/reload`.
- Wired daemon startup to delegate reload requests to `PipelineHandle.reloadConfig("command")`.
- Config-mutating commands now notify the daemon after durable writes and warn on notification failure.
- `jin sink enable/disable` now participates in the reload notification path without mutating runtime pause state directly.
- `jin sink enable/disable --yes` now has controlled-restart parity with other config-mutating sink commands.
- Existing config mutations and live reload now reject invalid sink/route/watch generations instead of silently normalizing malformed entries away.
- Startup now rejects invalid existing config instead of normalizing it into the live generation.
- Invalid live reload now stops without running shutdown final-flush against stale sinks/routes.
- Active push work now checks durable sink enablement before each local batch, so disabling a sink stops remaining local batches after any already-in-flight batch.
- BP-08 and the config mutation Mermaid source clarify accepted-vs-completed reload semantics.
- Pasteur review findings were addressed: direct sink pause mutation removed, `--yes` parity added, and strict runtime config generation validation added.
- Rawls/Euler review findings were addressed: startup strict validation, no-flush fatal reload shutdown, active push batch gating, and route help `--yes` visibility.

## Validation

- `bun run typecheck`
- `bun test test/config-mutation-control.test.ts test/local-control-boundary.test.ts test/daemon-query-boundary.test.ts test/desktop-shell-service.test.ts`
- `bun test test/config.test.ts test/config-mutation-control.test.ts`
- `bun test test/pipeline-spine.test.ts test/runtime-store-cutover.test.ts`
- `bun run test:release-gates`
- Disposable real-daemon smoke: `bun /private/tmp/jin-midrun-reload-smoke.ts ./jin .`
