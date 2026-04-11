# W3-SERVICE-01: Bump Version, Build, Install, Service Rollout

## Role

Codex worker packet.

## Goal

From an isolated clean worktree based on the approved baseline, bump the
product version to `0.8.5`, rebuild the binary, install it to
`~/.local/bin/jin`, and bring the local macOS launchd service up with bounded
verification.

This packet exists because the canonical workspace currently contains
in-progress `W3-ADAPTER-06` edits. Local service rollout should not pull those
unreviewed changes into the installed binary.

## Depends On

- `W3-PERF-01-codex-ingest-rss-budget.md`
- `W3-V2-01-final-steps-before-e2e.md`

## Unblocks

- local service-mode validation on a clean post-perf baseline
- a user-visible `0.8.5` binary install

## Read In Order

1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/01-dispatch-protocol.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/04-frozen-contract-surface.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/05-live-control-plane.md`
5. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W3-SERVICE-01-bump-version-build-install-service.md`

Then read the shared control plane from the canonical repo:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/program.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/blueprints.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-SERVICE-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-PERF-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`

## Worktree

- operate in `/tmp/jin-w3-service-01`
- do not use the canonical workspace for product edits in this packet

## Owned Files In The Worktree

- `package.json`
- `src/updater.ts`

## Owned Audit Artifact In Canonical Repo

- `/Users/edenmendel/Documents/GitHub/jin/docs/execution/audits/2026-04-08-W3-SERVICE-01-local-service-rollout.md`

## Forbidden Files

- any product source beyond the version strings above
- canonical workspace product files
- `src/adapters/claude-code.ts`
- any `.execution/reviews/**` files

## Deliverables

- version bumped to `0.8.5`
- rebuilt binary from the isolated worktree
- installed binary at `~/.local/bin/jin` reports `0.8.5`
- local service installed/loaded from that binary
- durable audit artifact records the exact commands and observed outputs

## Command Sequence

Run, in order:

1. bump version in `package.json` and `src/updater.ts` from `0.8.4` to `0.8.5`
2. `bun run build`
3. `./jin version`
4. `install -m 755 ./jin ~/.local/bin/jin`
5. `~/.local/bin/jin version`
6. `~/.local/bin/jin service uninstall || true`
7. `~/.local/bin/jin service install`
8. `~/.local/bin/jin service status`
9. `launchctl print gui/$(id -u)/com.jin.agent`
10. `~/.local/bin/jin status --json`

If the service is loaded but the runtime is not stable, record that exactly.
Do not widen into runtime debugging or product fixes in this packet.

## Acceptance Checks

- installed binary reports `jin 0.8.5`
- `jin service install` succeeds from the installed binary
- launchd shows the service loaded under `com.jin.agent`
- audit artifact records exact outputs and does not overclaim beyond the
  observed service state

## Stop And Escalate

Stop if:

- version bump touches files outside packet ownership
- build fails in the clean worktree
- launchd/service control requires unrelated product changes

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- no product BP change; local rollout packet only

V1 comparison:
- no prior v1 surface

BP alignment:
- no blueprint state change; local service rollout only

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
