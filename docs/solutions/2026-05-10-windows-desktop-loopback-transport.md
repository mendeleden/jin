---
title: Windows Desktop uses loopback transport
date: 2026-05-10
tags: [daemon, config, desktop]
related: [feat/jin-desktop]
---

# Windows Desktop uses loopback transport

## Problem

The desktop branch could build on Windows, but the runtime API still assumed a Unix-style socket boundary. A Windows named-pipe attempt reached daemon startup, then Bun failed while listening on the pipe path. Electron also imports daemon status modules, so any status/control code on that path must run without `Bun` globals.

## Solution

Keep Unix platforms on the existing socket file, and give Windows a deterministic `127.0.0.1` endpoint derived from the resolved Jin config directory. The daemon serves the same typed local API over Bun loopback HTTP on Windows, while the desktop daemon client accepts either an HTTP endpoint or a socket path. Status and control helpers imported by Electron use Node primitives instead of `Bun.spawnSync`.

## Key Insight

For Jin Desktop, "local daemon transport" should be treated as an opaque local endpoint, not as a literal filesystem socket. Unix sockets and Windows loopback HTTP can share the same typed routes and compatibility contract without making Electron depend on Bun-only process APIs.

## Prevention

Keep focused tests that force the Windows transport branch and the packaged Desktop lifecycle path, even when running from a different host OS. Validate the desktop branch with `desktop:typecheck`, the daemon query boundary tests, and a real Windows daemon start before treating Electron as runnable.

## Related

- `feat/jin-desktop`

## Files Changed

- `desktop/daemon-client.ts`
- `src/api/server.ts`
- `src/daemon/runtime-state.ts`
- `src/daemon/process-state.ts`
- `src/daemon/daemonize.ts`
- `src/api/control.ts`
- `test/daemon-query-boundary.test.ts`
