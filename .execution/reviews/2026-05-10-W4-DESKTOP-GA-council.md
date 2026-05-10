# Council Review: Jin Desktop GA Transport

- **date**: 2026-05-10
- **type**: release-council + tooling-council
- **scope**: Jin Desktop local daemon transport, Windows GA hardening, Bun runtime fit
- **packet**: `.execution/packets/W4-DESKTOP-GA.md`

## Research Packet

### Jin Context

The `feat/jin-desktop` branch successfully builds and boots Electron on Windows after the daemon transport was changed from a Unix socket assumption to a Windows loopback endpoint. The daemon successfully served Desktop compatibility and overview data through `http://127.0.0.1:43006` on this machine.

Current implementation proof points:

- Unix platforms keep socket-file transport.
- Windows computes a deterministic loopback endpoint from the resolved config directory.
- Desktop daemon client can request either HTTP local endpoints or Unix socket paths.
- Electron main imports should not rely on `Bun` globals.

Observed Windows failure:

- Bun failed when asked to listen on a Windows named-pipe-style path.
- Loopback HTTP with `Bun.serve` succeeded and kept the daemon running.

### Bun Capabilities

- Latest available from public Bun site/releases at research time: `1.3.13`.
- Local machine used for proof: `1.3.10+30e609e08`.
- Bun docs document `Bun.serve` over HTTP ports.
- Bun docs document `Bun.serve({ unix })` for Unix domain sockets and Linux abstract namespace sockets.
- Bun compatibility docs list `node:http` and `node:net` as implemented, while also describing Node compatibility as an ongoing project.
- Public Bun server docs do not document Windows named-pipe HTTP serving as a supported `Bun.serve` mode.

### External Patterns

- Docker Desktop / Docker Engine:
  - Windows default daemon path is named pipe: `npipe:////./pipe/docker_engine`.
  - TCP loopback `tcp://localhost:2375` exists but is treated as optional/legacy and security-sensitive.
- Datadog Agent:
  - Local Agent uses loopback ports for GUI/IPC/APM/DogStatsD surfaces.
  - GUI is localhost-only and token-authenticated.
- Stripe CLI:
  - Uses local forwarding to developer endpoints such as `localhost:4242`.
  - Useful as developer-tool precedent, but not daemon-control precedent.
- Node.js:
  - Documents Windows named-pipe IPC support via `net`/server path APIs.
- RFC 8252:
  - Treats loopback HTTP without TLS as acceptable when traffic stays on-device.
  - Recommends loopback IP literals over `localhost`.

## Release Council

| Persona | Company Archetype | Vote | Rationale |
|---|---|---|---|
| Release Captain | Desktop SaaS | CONDITIONAL BETA | The branch is viable, but GA requires auth, diagnostics, installer/update, and clean-machine smoke. |
| Security Lead | Local agent vendor | BLOCK GA | Unauthenticated localhost daemon control is not acceptable. Token and strict loopback binding are mandatory. |
| Windows Platform Lead | Developer tooling | CONDITIONAL BETA | Loopback is acceptable because Bun named-pipe serving is not verified; keep named pipes as future hardening. |
| Support Lead | CLI/devtools | CONDITIONAL BETA | Localhost diagnostics are supportable if failures are explicit and secret redaction is guaranteed. |

### Release Council Verdict

- Beta: **approved with P0 conditions**
- GA: **blocked until auth, strict binding, port-collision handling, packaging/update, diagnostics, and security review land**

## Tooling Council

| Persona | Company Archetype | Vote | Rationale |
|---|---|---|---|
| Bun Runtime Specialist | Runtime/toolchain | APPROVE SPLIT | Use documented Bun HTTP on Windows; do not rely on undocumented named-pipe behavior. |
| Node/Electron Specialist | Desktop app platform | APPROVE SPLIT | Electron can consume either endpoint; daemon runtime should avoid Node sidecar complexity for GA. |
| Docker Desktop Specialist | Privileged daemon tooling | CONDITIONAL | Named pipes are the better Windows default for privileged daemon control, but loopback plus token is acceptable for Jin's current risk profile. |
| Datadog Agent Specialist | Local observability agent | APPROVE SPLIT | Localhost Agent-style model is common if localhost-only and token-authenticated. |

### Tooling Council Verdict

- Keep split transport: **4-0**
- Make loopback universal across Unix/macOS/Linux/Windows: **0-4**
- Revisit named pipes later: **3-1**

## Decision

Keep Unix sockets on Unix platforms and Windows loopback HTTP on Windows.

Do not normalize all platforms to loopback HTTP for GA. The split preserves the tighter Unix local IPC behavior where it already works and limits the Windows compromise to the platform/runtime combination that needs it.

## Required GA Follow-Up

1. Add local API auth before beta.
2. Bind Windows only to `127.0.0.1`.
3. Rename transport concepts from `socketPath` to endpoint language.
4. Add port-collision handling and persisted endpoint state.
5. Harden Electron IPC and CSP.
6. Add diagnostics with secret redaction.
7. Add Windows CI and clean-machine release checklist.
8. Document transport ADR and named-pipe revisit criteria.

## Sources

- Docker Desktop FAQ: `npipe:////./pipe/docker_engine`, optional TCP localhost path
- Docker CLI socket docs: Unix, TCP, SSH, and Windows named-pipe daemon hosts
- Docker Desktop settings: exposing TCP localhost without TLS is security-sensitive
- Datadog Agent network docs: local Agent ports and GUI/IPC ports
- Datadog Agent Manager Windows docs: GUI is localhost-only and token-authenticated
- Stripe CLI docs: forwarding to local webhook endpoints
- Node.js `net` docs: Windows named-pipe IPC support
- Bun server docs: HTTP and Unix socket serving
- Bun Node compatibility docs: `node:http` and `node:net` compatibility status
- RFC 8252: loopback IP literal security guidance
