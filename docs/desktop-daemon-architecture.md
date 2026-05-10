---
title: "Desktop Daemon Architecture"
status: draft
created: 2026-04-20
depends-on:
  - docs/blueprint/BP-07-process-lifecycle.md
  - docs/execution/tasks/W4-DESKTOP-01-daemon-query-boundary.md
  - docs/jin-desktop-prd.md
---

# Desktop Daemon Architecture

This note captures the current approved Desktop shape:

- `jin` daemon remains the only runtime
- Electron Desktop is a client of the daemon boundary
- the canonical store stays inside the daemon runtime
- Desktop consumes a local control/query surface instead of owning a second backend

## 1. Component Diagram

```mermaid
flowchart LR
  subgraph Desktop["Electron Desktop App"]
    Renderer["Renderer UI
Home / Conversations / Search / Trace / Health"]
    Main["Main Process
IPC bridge + daemon client"]
    Renderer --> Main
  end

  subgraph Daemon["jin Long-Lived Daemon Process"]
    Watch["watchCommand()"]
    Pipeline["runPipeline()
watchers + ingest + push scheduling"]
    Api["Local API Server
status + lifecycle + read-only queries"]
    Routes["API Routes"]
    Control["LocalControlBoundary"]
    Store["Canonical SQLite Store"]
    Runtime["Runtime / process state"]
  end

  Main -->|"Linux/macOS: Unix socket
Windows: 127.0.0.1 loopback + token"| Api

  Watch --> Pipeline
  Watch --> Api

  Api --> Routes
  Routes --> Store
  Routes --> Runtime
  Routes --> Control

  Pipeline <--> Store
  Pipeline --> Runtime

  Control -->|"delegates lifecycle actions
through existing CLI entrypoints"| Watch

  CLIRead["CLI read-only commands"] -->|"direct SQLite remains allowed"| Store
```

## 2. Read Query Sequence

```mermaid
sequenceDiagram
  participant UI as Desktop UI
  participant Main as Electron Main
  participant API as Daemon API Server
  participant Store as SQLite Store
  participant Pipe as Runtime Pipeline

  UI->>Main: open Conversations
  Main->>API: GET /api/conversations
  API->>Store: query conversations
  Store-->>API: rows
  API-->>Main: JSON response
  Main-->>UI: view model

  Pipe->>Store: ingest/update conversations
  UI->>Main: refresh / poll
  Main->>API: GET /api/overview
  API->>Store: read latest state
  Store-->>API: summary
  API-->>Main: JSON response
  Main-->>UI: updated overview
```

## 3. Notes

- The API server is in-process with the daemon runtime, not a separate backend.
- Phase 1 Desktop work targets the approved daemon query boundary from `W4-DESKTOP-01`.
- Linux and macOS use the current Unix-socket boundary.
- Windows uses an authenticated `127.0.0.1` loopback endpoint because Bun's
  public server surface supports HTTP and Unix sockets, while Windows named-pipe
  HTTP serving is not currently verified for the daemon runtime.
- Desktop distribution should treat Windows as a parity target, but Windows GA
  remains blocked on the hardening checklist in `W4-DESKTOP-GA`: auth, strict
  loopback binding, collision handling, diagnostics, packaging/update, and
  security review.
- Revisit Windows named pipes only when Bun documents support or a minimal
  Windows named-pipe server repro passes on supported Windows versions.

## 4. Type Contract Rule

The Desktop/daemon boundary should reuse the v2 domain model for canonical
entities instead of cloning those entities into a second DTO layer.

Use the existing v2 entity types directly for:

- `Conversation`
- `Message`
- `ToolCall`
- store/push-state entities when surfaced to Desktop

Still define explicit boundary types for responses that are product-shaped
compositions rather than single ontology objects, such as:

- overview summaries
- conversation detail views
- trace views
- tree views
- local control/status responses

Future Desktop work should also drop v1 compatibility aliases from the typed
boundary:

- no `parentSessionId`
- no mixed snake_case and camelCase duplicates
- no legacy `session` naming as the primary canonical contract
