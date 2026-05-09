---
title: Daemon query boundary needs handler-level socket proof
date: 2026-04-17
tags: [daemon, lifecycle, testing, api]
related: [W4-DESKTOP-01, W2-DAEMON-02, W2-CMD-01, BP-07, BP-01, BP-Product]
---

# Daemon query boundary needs handler-level socket proof

## Problem

The desktop daemon-query lane needed to prove two things at once:

- the long-lived runtime exposes a deterministic local socket path for future
  Desktop clients
- the daemon serves the same read-only overview/detail/trace/tree/search
  surface without requiring Desktop to open SQLite directly

The transport itself is awkward to validate in restricted workspaces because
`Bun.serve({ unix })` may be blocked by sandbox policy even when the code is
correct. Without a seam, the packet would either skip proof or rely on a much
broader integration test.

## Solution

The daemon boundary was split into two directly testable pieces:

1. `createApiFetchHandler()` owns request routing and can be exercised with an
   in-memory request against a seeded query store.
2. `startLocalApiServer()` owns socket-path startup and cleanup, but now accepts
   an injectable `serve` implementation so tests can prove deterministic socket
   selection, stale-socket cleanup, and shutdown behavior without opening a
   real Unix socket.

The packet also keeps socket discovery visible in the runtime/status surfaces:

- `getRuntimePaths().socketPath`
- `LocalControlStatusDto.paths.socket`
- `jin status --json` / full status output

## Key Insight

For daemon-boundary work, the durable pattern is:

- keep the HTTP handler separate from the transport bootstrap
- inject the transport edge in tests
- prove the same route set through both direct handler tests and boundary-state
  discovery tests

That keeps the packet narrow and reviewable even when the environment cannot
bind a real Unix socket.

## Prevention

- Future daemon-boundary packets should add a handler-level test plus a
  transport-startup test whenever they introduce a new socket/IPC surface.
- If endpoint discovery matters, assert it in both control/status DTOs and
  focused tests instead of assuming clients will reconstruct paths correctly.
- Treat overview/detail/trace/tree/search coverage as one packet-local matrix;
  do not call the query boundary done after proving only one or two routes.

## Related

- `W4-DESKTOP-01` uses this pattern for the first Desktop-facing daemon query
  surface.
- `W2-DAEMON-02` and `W2-CMD-01` provided the lifecycle and read-only route
  building blocks reused here.
- `BP-07`, `BP-01`, and `BP-Product` are the governing constraints: one
  runtime, Desktop as daemon client, and API/lifecycle ownership staying out of
  pipeline internals.

## Files Changed

- `src/api/server.ts`
- `src/api/control.ts`
- `src/api/routes.ts`
- `src/commands/watch.ts`
- `src/commands/status.ts`
- `src/daemon/runtime-state.ts`
- `test/local-control-boundary.test.ts`
- `test/read-only-query-surface.test.ts`
- `test/daemon-query-boundary.test.ts`
