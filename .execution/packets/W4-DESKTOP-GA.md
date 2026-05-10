# Packet State

- packet: `W4-DESKTOP-GA`
- title: `Jin Desktop GA Transport and Release Hardening`
- status: `in_progress`
- assigned agent: `codex-BRAIN`
- branch: `feat/desktop-add-windows`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `feat/jin-desktop Windows bring-up proof`, `desktop daemon loopback query proof`
- unblocks: `Jin Desktop beta`, `Jin Desktop GA release readiness`
- last transition: `2026-05-10`
- next Codex action: `continue P0 Electron security, lifecycle reliability, diagnostics, packaging, and release validation after the auth/transport slice`
- latest review: `.execution/reviews/2026-05-10-W4-DESKTOP-GA-council.md`

## Progress

- `2026-05-10`: landed first Windows parity slice on `feat/desktop-add-windows`:
  per-install Desktop API token, authenticated Desktop routes, strict Windows
  `127.0.0.1` loopback endpoint, and Unix socket preservation.
- `2026-05-10`: added endpoint observability and collision diagnostics:
  `localEndpoint` is persisted in runtime ownership state, surfaced in status and
  Desktop control status, and Windows bind failures now report an actionable
  port-in-use diagnostic.
- `2026-05-10`: hardened the Electron shell: sandboxed preload, strict CSP,
  denied renderer navigation/window-open escapes, and typed IPC argument
  validation at the main-process boundary.
- `2026-05-10`: opened the Windows x64 packaging path: Desktop release asset
  selection now accepts `jin-desktop-windows-x64.zip`, `desktop:build` cleans
  stale dist output cross-platform, and `desktop:package --target=windows-x64`
  produces a launchable packaged app.
- Validation for the transport slice:
  `bun run typecheck`, `bun run desktop:typecheck`, focused Desktop/daemon tests,
  `bun run desktop:build`, Windows daemon stop/start/status smoke, Desktop API
  auth smoke (`200` with token, `401` without), and live occupied-port smoke.
- Validation for the Electron security slice:
  `bun run typecheck`, `bun run desktop:typecheck`, focused Desktop IPC/renderer
  tests, `bun run desktop:build`, and bounded Windows Electron boot smoke.
- Validation for the Windows packaging slice:
  `bun run typecheck`, focused Desktop command/shell tests,
  `bun run desktop:typecheck`, `bun run desktop:package --target=windows-x64`,
  zip payload inspection, and packaged executable boot smoke from a temp
  extraction.

## Decision

Keep a split local transport:

- macOS/Linux: keep Unix domain socket transport.
- Windows: use loopback HTTP on `127.0.0.1` until Bun has a documented and verified Windows named-pipe HTTP server path.

Do not normalize all platforms to loopback HTTP for GA. Unix sockets preserve the tighter default local IPC shape on Unix platforms, avoid new port-collision/firewall surface area, and match existing daemon assumptions. Windows loopback is a pragmatic runtime-specific accommodation, not a new universal architecture preference.

## Why Split Transport

- Docker's Windows default uses named pipes for privileged daemon control, with localhost TCP treated as optional/legacy and security-sensitive.
- Datadog's Agent uses localhost ports for local GUI/IPC surfaces, but pairs that model with localhost-only access and token/auth expectations.
- Stripe CLI validates the developer-tool loopback pattern for forwarding local traffic, but it is not a privileged daemon-control precedent.
- Node documents Windows named-pipe IPC support, but Bun's current public server docs document HTTP ports and Unix sockets, not Windows named-pipe HTTP serving.
- The local Windows proof on this branch showed Bun failing on a named-pipe listen path and succeeding on `127.0.0.1` loopback.

## Release Bar

Jin Desktop is GA-ready only when it is safe to install, start, update, diagnose, and uninstall on Windows without:

- opening unauthenticated local control surfaces
- binding to non-loopback interfaces
- losing or corrupting local daemon/store state
- depending on undocumented Bun named-pipe behavior
- surprising users with visible process windows or admin-only flows
- requiring thread context to diagnose failures

## Workstreams

### P0 Auth And Transport

- Generate a per-install Desktop API secret under the Jin config directory.
- Require the secret on every Desktop API route.
- Redact the secret from logs, status JSON, renderer errors, and diagnostics.
- Bind Windows transport to `127.0.0.1` only.
- Refuse `localhost`, `0.0.0.0`, LAN IPs, and env/config overrides that expose the API.
- Handle occupied Windows ports explicitly:
  - reuse if already owned by this Jin runtime
  - fail with actionable diagnostics if owned by another process
  - persist active endpoint in runtime state
- Keep Unix platforms on socket files.
- Rename internal concepts from `socketPath` to `localEndpoint` or equivalent to avoid hiding transport plurality.

### P0 Electron Security

- Keep `contextIsolation: true`. `Done on feat/desktop-add-windows`.
- Keep `nodeIntegration: false`. `Done on feat/desktop-add-windows`.
- Re-audit `sandbox: false`; either remove it or document why it is required. `Done: preload now builds to sandbox-compatible CJS and sandbox true is enabled.`
- Add a strict Content Security Policy. `Done on feat/desktop-add-windows`.
- Validate every IPC argument at the main-process boundary. `Done on feat/desktop-add-windows`.
- Ensure renderer code never receives raw filesystem secrets.
- Confirm browser-origin requests cannot control the daemon even with local network access. `Partially done: daemon API requires the Desktop token; remaining browser-origin verification belongs in the release validation lane.`

### P0 Lifecycle Reliability

- Ensure `start`, `stop`, `restart`, and `status` work in dev, compiled CLI, and packaged Desktop modes.
- Preserve hidden Windows process behavior: no PowerShell/conhost flashing.
- Recover stale PID/runtime-state files.
- Avoid duplicate daemon owners.
- Make daemon crash and store-poisoning states diagnosable from Desktop.

### P1 Packaging And Updates

- Define whether Desktop and CLI install/update together or as versioned peers.
- Implement or harden `jin desktop --update`.
- Add rollback path.
- Code-sign Windows artifacts.
- Decide installer metadata, Start menu entries, uninstall behavior, and local-data preservation policy.
- Verify clean install, upgrade, downgrade, and uninstall on Windows 10/11.
- Windows x64 zip packaging smoke. `Done on feat/desktop-add-windows; installer/signing/start-menu/update policy still remains.`

### P1 Diagnostics

- Add Desktop diagnostics export or summary.
- Include versions, runtime state, endpoint kind, recent logs, config paths, and compatibility status.
- Redact all secrets.
- Distinguish stopped daemon, auth failure, port collision, incompatible version, and store problems.

### P1 Test Matrix

- Unit tests for transport selection, endpoint auth, lifecycle command resolution, and route compatibility.
- Integration test for Windows loopback API.
- Electron smoke test for window boot, preload bridge, and snapshot rendering.
- Start/stop/restart smoke test.
- Port collision and stale runtime-state tests.
- Windows CI lane with Bun.
- Manual clean-machine release checklist.

### P2 Named Pipe Investigation

- File or prepare a minimal Bun repro for Windows named-pipe HTTP serving.
- Compare Node named-pipe server behavior with Bun behavior.
- Evaluate whether a tiny Node sidecar is worth the extra runtime complexity.
- Revisit named pipes only if Bun documents support or a minimal repro passes on supported Windows versions.

## Owned Files For Future Implementation Lanes

Likely owned surfaces after this packet is split:

- `desktop/daemon-client.ts`
- `desktop/main.ts`
- `desktop/preload.ts`
- `desktop/shell-service.ts`
- `src/api/server.ts`
- `src/api/routes.ts`
- `src/api/control.ts`
- `src/contracts/desktop.ts`
- `src/daemon/runtime-state.ts`
- `src/daemon/daemonize.ts`
- `src/daemon/process-state.ts`
- `src/commands/desktop.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `test/daemon-query-boundary.test.ts`
- `test/desktop-shell-service.test.ts`
- `test/local-control-boundary.test.ts`

## Forbidden Or High-Risk Boundaries

- Do not silently change frozen lifecycle ownership semantics.
- Do not extend Desktop API contracts without updating `src/contracts/desktop.ts` and compatibility/version handling.
- Do not make Unix platforms use loopback HTTP unless Codex explicitly changes the transport decision.
- Do not expose daemon control routes over non-loopback interfaces.
- Do not let renderer code bypass typed preload IPC.

## Acceptance Checks

- `bun run typecheck`
- `bun run desktop:typecheck`
- focused tests for daemon query, desktop shell service, and local control boundary
- Windows daemon start/status/stop smoke
- Desktop API auth smoke
- Electron boot smoke on Windows
- packaged Desktop lifecycle smoke
- clean-machine install/update/uninstall checklist

## BP Acceptance Matrix

- Local daemon lifecycle ownership -> must remain aligned with lifecycle contract; implementation lane must cite code and tests.
- Desktop API compatibility -> must be implemented through `src/contracts/desktop.ts` versioning and tested by desktop shell service tests.
- Runtime transport -> split transport accepted for GA only with auth, loopback-only Windows binding, and Unix socket preservation.
- Store/data safety -> Desktop must remain read-only for conversation data unless a lane explicitly owns config/lifecycle mutation.
- Release/update behavior -> deferred until packaging/update lane is split from this packet.

## V1 Comparison

- Prior v1 surface: legacy local dashboard/TUI surfaces existed but are not the target architecture.
- Intentional change: Desktop becomes the typed native shell over daemon-owned local API routes.
- Regression risk: loopback transport expands local attack surface on Windows unless auth and strict binding land before beta/GA.

## Council Summary

Release council: approve beta only after auth, diagnostics, and loopback hardening; block GA until packaging/update/security review is complete.

Tooling council: keep Bun loopback on Windows now; preserve Unix sockets elsewhere; revisit named pipes only with documented Bun support or a passing repro.
