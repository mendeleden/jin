# Proposal: Unix Socket Daemon Boundary

**Status:** Draft
**Created:** 2026-04-07
**Relates to:** BP-07 (Process Lifecycle), BP-Product-Strategy

---

## Problem

Jin's daemon boundary today is a patchwork of file-based state and an
HTTP-on-localhost server:

1. **CLI → daemon control** goes through subprocess spawning (`Bun.spawnSync([binPath, action])` in `src/api/control.ts`). Starting or stopping jin from the Desktop UI spawns a whole CLI process.

2. **Live events** require connecting to the HTTP server on `localhost:4000`. This port is discoverable only by reading `~/.jin/ui.port` — a file that might be stale, and a port that might be occupied by another process.

3. **No command channel to the daemon.** There is no way to tell a running daemon "re-ingest now" or "pause sink X" without restarting it or writing a new config file. BP-07 acknowledges this gap: write-capable one-shot commands must currently "fail fast or delegate through the daemon boundary," but no such delegation path exists.

4. **Desktop boundary is undefined.** BP-07 says "Desktop is a client of the daemon boundary" and explicitly leaves the transport open (HTTP, Unix socket, named pipe, library calls). The current `LocalControlBoundary` in `src/api/control.ts` spawns subprocesses — workable for a web UI, but not a real IPC contract for a native Desktop app that needs low-latency status polling and live event streaming.

5. **Port conflicts.** `localhost:4000` is a common port. Two users on a shared machine, or jin + another dev tool, can collide. The current server silently fails if the port is taken.

---

## Proposal: Unix Domain Socket as Primary Daemon Boundary

Replace the file-based control path and optional HTTP server with a **Unix domain socket** as the canonical daemon boundary. The daemon listens on this socket from startup. All clients — CLI commands, Desktop app, MCP server, web UI — connect to it.

### The Docker Precedent

Docker solved an identical problem: a long-running daemon (dockerd) that
must be controllable by CLI commands (`docker ps`), desktop apps (Docker
Desktop), and third-party tools (Portainer, CI systems) — all through a
single, stable boundary.

Docker's answer: **REST API over a Unix domain socket** at `/var/run/docker.sock`.

| Property | Docker | Proposed Jin |
|----------|--------|-------------|
| Socket path | `/var/run/docker.sock` | `~/.jin/jin.sock` |
| Protocol | HTTP/1.1 over UDS | HTTP/1.1 over UDS |
| Auth model | Filesystem permissions on socket | Filesystem permissions on socket |
| Streaming | `GET /events` (chunked JSON) | `GET /events` (SSE) |
| CLI integration | Every `docker` command = HTTP request | Write commands + status = HTTP request |
| Desktop integration | Docker Desktop connects to same socket | Jin Desktop connects to same socket |
| Windows | Named pipe `\\.\pipe\docker_engine` | Named pipe `\\.\pipe\jin` (future) |

The key lesson from Docker: **one socket, one API, every client.** No
separate CLI-specific subprocess spawning, no separate Desktop-specific
protocol, no port files to discover.

### What Changes

```
Before:
  CLI read commands ──── SQLite direct ──────────────── store.db
  CLI lifecycle    ──── subprocess spawn ─── jin binary ─── daemon
  Web UI           ──── HTTP localhost:4000 ──────────── daemon (separate server)
  Desktop          ──── ??? (undefined) ─────────────── ???

After:
  CLI read commands ──── SQLite direct ──────────────── store.db  (unchanged)
  CLI lifecycle    ──── HTTP over UDS ───────────────── daemon
  CLI write cmds   ──── HTTP over UDS ───────────────── daemon
  Desktop          ──── HTTP over UDS ───────────────── daemon
  MCP server       ──── HTTP over UDS ───────────────── daemon
  Web UI           ──── HTTP over UDS ───────────────── daemon
```

**Read-only CLI commands stay on direct SQLite.** This is a deliberate
choice: `jin show`, `jin conversations`, `jin search` should work without
the daemon, and they don't need real-time data. This matches BP-07
Invariant 3: "Query commands do not require the daemon."

### Socket Path

```
~/.jin/jin.sock
```

Same directory as `jin.pid` and `jin.runtime.json`. The daemon creates it
on startup, removes it on shutdown. Stale sockets (from a crash) are
detected by attempting a connect — if it fails, the file is orphaned and
can be replaced.

### API Surface

The socket exposes a JSON REST API. Every endpoint returns
`Content-Type: application/json`.

#### Lifecycle

```
GET  /v1/status              → RuntimeStatus (mode, pid, state, uptime, adapters, sinks)
POST /v1/stop                → { ok: true }  (triggers graceful shutdown)
POST /v1/restart             → { ok: true }  (stop + re-exec)
```

`start` is not on the socket — you can't ask a non-running daemon to start
itself. `jin start` remains a CLI-level operation that spawns the process.

#### Commands (new capability)

```
POST /v1/ingest              → { ok: true, queued: true }
POST /v1/ingest/:adapter     → { ok: true, queued: true }
POST /v1/sink/:id/disable    → { ok: true }
POST /v1/sink/:id/enable     → { ok: true }
POST /v1/push                → { ok: true, queued: true }
```

These enqueue work items on the coordinator's work queue (the same queue
that file watcher events and periodic scans use). They return immediately
with `queued: true` — the actual work happens asynchronously.

This is the "delegate through the daemon boundary" path that BP-07
describes but doesn't yet implement.

#### Queries (optional, for Desktop convenience)

```
GET  /v1/conversations       → Conversation[]  (same as CLI, with query params)
GET  /v1/conversations/:id   → ConversationDetail
GET  /v1/stats               → StatsResponse
GET  /v1/sync-status         → SinkSyncStatus[]
```

These query SQLite through the daemon's open store handle. They're
optional — Desktop could also read SQLite directly — but routing through
the socket means Desktop never needs to know the store path or handle
SQLite directly.

#### Events (streaming)

```
GET  /v1/events              → SSE stream
```

Event types:

| Event | Payload | When |
|-------|---------|------|
| `conversation.ingested` | `{ id, adapterId, name }` | New or updated conversation stored |
| `conversation.pushed` | `{ id, sinkId }` | Conversation pushed to sink |
| `sink.state` | `{ sinkId, state, error? }` | Sink health change |
| `runtime.state` | `{ state, issues[] }` | Runtime state transition |
| `ingest.progress` | `{ adapterId, found, processed }` | Batch ingest progress |

Desktop connects to this stream on launch and stays connected. No polling.

### Version Prefix

All routes are under `/v1/`. If the API needs breaking changes, `/v2/`
can coexist during a transition period. The Docker API does the same
(`/v1.41/containers/json`).

---

## What This Replaces

| Current | Replacement |
|---------|-------------|
| `~/.jin/ui.port` file | Gone — socket path is deterministic |
| `~/.jin/ui.pid` file | Gone — socket lifecycle tied to daemon |
| Separate HTTP server on random port | Daemon serves on socket directly |
| `LocalControlBoundary` subprocess spawning | HTTP calls over socket |
| `broadcastEvent()` to HTTP SSE clients | Same SSE, now over socket |
| Web UI standalone server | Daemon serves static assets + API on socket |

### What This Does NOT Replace

| Stays | Why |
|-------|-----|
| `~/.jin/jin.pid` | Still useful for signal-based stop and stale detection |
| `~/.jin/jin.runtime.json` | Still useful for `jin status` when daemon is dead |
| Direct SQLite reads by CLI | BP-07 Invariant 3 — queries work without daemon |
| `SIGTERM` for stop | Socket-based stop is preferred, signal is fallback |

---

## Implementation Sketch

### Bun Unix Socket Server

Bun natively supports Unix domain sockets via `Bun.serve()`:

```typescript
const server = Bun.serve({
  unix: socketPath,   // e.g. ~/.jin/jin.sock
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/status") return Response.json(getStatus());
    if (url.pathname === "/v1/events") return streamSSE(req);
    // ...route handling
  },
});
```

No additional dependencies. No TCP port allocation.

### Client (CLI / Desktop)

```typescript
// CLI: one-shot request
const resp = await fetch("http://localhost/v1/status", {
  unix: socketPath,
});

// Desktop: persistent SSE connection
const events = new EventSource("http://localhost/v1/events", {
  // Bun/Node EventSource with unix socket support,
  // or raw fetch + ReadableStream
});
```

The `http://localhost` host is ignored when connecting over a Unix socket —
only the path matters. This is the same convention Docker uses.

### Web UI Access

For the web UI (browser-based), the daemon can optionally also listen on a
TCP port. But the socket is primary — the TCP listener is opt-in for
browser access:

```typescript
// Primary: always
Bun.serve({ unix: "~/.jin/jin.sock", fetch });

// Optional: only if web UI is requested
if (config.ui?.enabled) {
  Bun.serve({ port: config.ui.port ?? 4000, fetch });
}
```

This separates the daemon boundary (socket, always on) from the web UI
surface (TCP, opt-in).

### Desktop Connection Flow

```
1. Desktop launches
2. Attempts connect to ~/.jin/jin.sock
3. If socket exists and responds → daemon is running
   - Subscribe to /v1/events SSE stream
   - Show live status
4. If socket missing or connect fails → daemon is not running
   - Show "jin is stopped" state
   - Offer "Start" button → spawn `jin start` subprocess
   - Retry socket connection after spawn
```

No port discovery. No PID file parsing. No process table scanning.

---

## Cross-Platform

| Platform | Transport | Path |
|----------|-----------|------|
| macOS | Unix domain socket | `~/.jin/jin.sock` |
| Linux | Unix domain socket | `~/.jin/jin.sock` |
| Windows | Named pipe | `\\.\pipe\jin` |

Bun supports both Unix sockets and Windows named pipes. The API surface is
identical — only the transport path changes. A `getSocketPath()` helper
abstracts this.

Docker uses the same split: `/var/run/docker.sock` on Linux/macOS,
`\\.\pipe\docker_engine` on Windows.

---

## Migration Path

This doesn't need to be a big-bang change. Incremental steps:

### Phase 1: Socket alongside HTTP (non-breaking)

- Add Unix socket listener to the existing daemon startup
- Existing HTTP server on `localhost:4000` continues working
- CLI lifecycle commands (`stop`, `restart`) try socket first, fall back
  to subprocess spawning
- Web UI still uses TCP

### Phase 2: CLI commands use socket for writes

- `jin ingest` delegates to daemon via socket when daemon is running
- `jin sink disable/enable` routes through socket
- `jin status` prefers socket, falls back to file-based state

### Phase 3: Desktop integration

- Desktop connects to socket for status + events
- Desktop sends lifecycle commands over socket
- Desktop queries conversations via socket (or direct SQLite — TBD)

### Phase 4: Deprecate standalone HTTP server

- Web UI served by daemon's optional TCP listener
- Remove `ui.pid`, `ui.port` files
- Remove `LocalControlBoundary` subprocess spawning

---

## Open Questions

1. **Should read queries go through the socket or stay on direct SQLite?**
   Direct SQLite is simpler and works without the daemon. But routing
   through the socket means Desktop doesn't need SQLite bindings (relevant
   for Electron). Could offer both and let the client decide.

2. **Auth / access control.** Docker's model (filesystem permissions on
   the socket file) is probably sufficient for jin's single-user case. But
   if jin ever supports multi-user machines, this needs revisiting.

3. **Web UI bundling.** Should the daemon serve the web UI's static assets
   over the socket (Desktop uses a webview pointed at it) or should
   Desktop bundle its own frontend? Docker Desktop bundles its own
   frontend and uses the socket only for API calls.

4. **Hot config reload.** BP-07 punts on hot reload ("config is snapshotted
   at process start"). A socket-based command channel makes hot reload
   trivial to add later: `POST /v1/config/reload`. Worth keeping the door
   open.

5. **MCP server integration.** The planned MCP server
   (`jin_list_conversations`, etc.) could either connect to the socket as
   a client, or the daemon could directly expose MCP protocol over a
   second socket. The former is simpler and keeps MCP as just another
   client.

---

## Decision Requested

Is this the right direction for the daemon ↔ Desktop boundary? Key
decision points:

- **Unix socket as primary boundary** — yes/no?
- **Phase 1 as next implementation step** — or defer until Desktop work begins?
- **Read queries via socket vs direct SQLite** — for Desktop specifically

---

## References

- [BP-07: Process Lifecycle](../blueprint/BP-07-process-lifecycle.md) — "Desktop is a client of the daemon boundary, not a second runtime"
- [BP-Product-Strategy](../blueprint/BP-Product-Strategy.md) — Desktop architecture
- [Docker Engine API docs](https://docs.docker.com/engine/api/) — Unix socket REST pattern
- [Bun.serve() Unix socket support](https://bun.sh/docs/api/http#unix-domain-sockets)
