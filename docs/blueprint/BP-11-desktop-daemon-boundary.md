---
title: "BP-11: Desktop Daemon Boundary"
status: draft
created: 2026-05-16
depends-on: [BP-05, BP-07, BP-08, BP-Product-Strategy]
informs: []
---

# BP-11: Desktop Daemon Boundary

## Principle

Jin Desktop is a client of the local daemon boundary. It does not own
ingestion, storage, routing, sink push, schema migration, or runtime
coordination.

The daemon owns canonical local state:

- runtime lifecycle state
- the SQLite conversation store
- the applied config snapshot
- bounded local diagnostics such as logs

Desktop receives typed, purpose-built views over that state. Every Desktop
surface should map to an explicit daemon capability, an explicit Electron IPC
channel, or both.

---

## Boundary Layers

There are two distinct boundaries.

| Layer | Owner | Consumer | Purpose |
|-------|-------|----------|---------|
| Local daemon API | Jin daemon | Desktop main process, CLI, future local clients | Typed local HTTP routes over the daemon transport |
| Electron IPC bridge | Desktop main/preload | Desktop renderer | Minimal renderer-safe methods exposed as `window.jinDesktop` |

The renderer must not know the daemon socket path, auth token, filesystem log
path semantics, SQLite schema, or process-control implementation. Those details
stay in the Desktop main process and daemon API client.

---

## Invariants

- Desktop is a view/controller over daemon-owned state, not a second runtime.
- Renderer IPC methods are typed product capabilities, not generic request
  tunnels.
- Desktop APIs return view models, not raw database rows.
- Read endpoints must not trigger ingest, push, remote schema mutation, or sink
  health checks unless the endpoint explicitly documents that side effect.
- Mutating endpoints must be lifecycle/config commands with narrow inputs and
  explicit validation.
- Bounded diagnostics are allowed; arbitrary filesystem reads are not.
- Any breaking Desktop payload change must bump `DESKTOP_API_VERSION` or
  `DESKTOP_MINIMUM_API_VERSION` as appropriate.

---

## Stable Desktop Daemon API

These routes are the current Desktop-owned daemon API surface.

| Route | Method | Response Contract | Purpose | Side Effects |
|-------|--------|-------------------|---------|--------------|
| `/api/desktop/compatibility` | GET | `DesktopCompatibilityInfo` | Report daemon/Desktop protocol versions and update commands | None |
| `/api/desktop/home` | GET | `DesktopHomeData` | Home dashboard aggregates from the canonical SQLite store | None |
| `/api/desktop/logs` | GET | `DesktopLogsView` | Return a bounded daemon log tail | None |
| `/api/desktop/routing` | GET | `DesktopRoutingView` | Compute project-to-sink routing from indexed conversations plus config routes | None |
| `/api/desktop/conversations` | GET | `DesktopConversationListView` | List conversations with Desktop filters and relationship summaries | None |
| `/api/desktop/conversations/:id` | GET | `DesktopConversationDetailView` | Load one conversation with messages, tool calls, parent/children, and trace summary | None |
| `/api/desktop/conversations/:id/trace` | GET | `DesktopTraceView` | Load the trace graph containing the selected conversation | None |
| `/api/desktop/conversations/:id/tree` | GET | `DesktopTreeView` | Load the rooted conversation tree containing the selected conversation | None |

### Routing View Semantics

`/api/desktop/routing` is a read-only interpretation endpoint.

It reads:

- projects and conversations from SQLite
- sinks and routes from the applied Jin config

It computes:

- project -> active sink flow counts
- unrouted conversation counts
- configured sink summaries
- configured route summaries

It does not:

- query Postgres, S3, webhook, or any remote sink
- push or repush data
- run sink health checks
- persist computed routing decisions

This keeps the view aligned with BP-08: routing is a pure function evaluated
from conversation fields plus config route rules.

---

## Local Control API

These routes are local runtime-control capabilities. They are not generic
Desktop renderer IPC methods by default; Desktop may expose narrow controls
through its bridge.

| Route | Method | Purpose | Side Effects |
|-------|--------|---------|--------------|
| `/api/control/status` | GET | Read current runtime ownership and health state | None |
| `/api/control/start` | POST | Request daemon/runtime start | Starts runtime if allowed |
| `/api/control/stop` | POST | Request daemon/runtime stop | Stops runtime if allowed |
| `/api/control/restart` | POST | Request restart | Stops and starts runtime if allowed |
| `/api/control/config/reload` | POST | Request coordinator-owned config reload | Applies config if runtime supports reload |

Desktop's current packaged control path goes through `LocalControlBoundary`,
not arbitrary shell commands from the renderer. Packaged Desktop must not shell
out to repo-local Bun or TypeScript entrypoints.

---

## Electron IPC Bridge

These are the renderer-visible IPC channels. Each channel maps to a typed method
on `JinDesktopBridge`.

| IPC Channel | Renderer Method | Source | Purpose |
|-------------|-----------------|--------|---------|
| `jin-desktop:home-snapshot` | `getHomeSnapshot()` | control boundary plus `/api/desktop/compatibility` and `/api/desktop/home` | Initial shell snapshot, runtime status, compatibility, and home data |
| `jin-desktop:control-action` | `runControlAction(action)` | `LocalControlBoundary` | Start, stop, or restart Jin |
| `jin-desktop:logs` | `getLogs(request)` | `/api/desktop/logs` | Load bounded native daemon logs |
| `jin-desktop:routing` | `getRouting()` | `/api/desktop/routing` | Load project-to-sink routing graph data |
| `jin-desktop:conversation-list` | `listConversations(request)` | `/api/desktop/conversations` | Load the conversation library |
| `jin-desktop:conversation-detail` | `getConversationDetail(id)` | `/api/desktop/conversations/:id` | Load selected conversation detail |
| `jin-desktop:trace-view` | `getTraceView(id)` | `/api/desktop/conversations/:id/trace` | Load trace graph data |
| `jin-desktop:tree-view` | `getTreeView(id)` | `/api/desktop/conversations/:id/tree` | Load rooted tree data |

IPC inputs must be parsed and validated in Desktop main before they reach the
daemon client. Renderer-provided values are untrusted even though Desktop is a
local app.

---

## Existing Non-Desktop Local Query Routes

The daemon also exposes local query routes used by older surfaces and local
clients:

| Route Family | Status | Notes |
|--------------|--------|-------|
| `/api/overview` | compatibility | Legacy overview shape |
| `/api/conversations`, `/api/sessions` | compatibility | Session aliases remain for existing clients |
| `/api/conversations/:id`, `/api/sessions/:id` | compatibility | Supports legacy trace/tree query flags |
| `/api/search` | local query | Search messages through the canonical store |
| `/api/analytics/*` | local query | Timeline, adapters, models, tools, and projects aggregates |
| `/api/projects`, `/api/projects/:id/*` | local query | Project-centric conversation views |
| `/api/tags` | placeholder | Returns current tag surface |
| `/api/artifacts`, `/api/artifacts/:id` | placeholder | Artifact surface is not a Desktop contract yet |

New Desktop work should prefer `/api/desktop/*` routes with explicit Desktop
contracts. Reusing compatibility routes in Desktop creates accidental coupling
to legacy shapes and should be treated as BP drift.

---

## Adding a New Desktop Boundary Capability

Any new Desktop surface that needs daemon data should update this BP and land
the following pieces together:

1. Contract type in `src/contracts/desktop.ts`.
2. Daemon route in `src/api/routes.ts` if the data comes from daemon-owned
   state.
3. Desktop daemon client method in `desktop/daemon-client.ts`.
4. Desktop shell service method in `desktop/shell-service.ts`.
5. Renderer IPC channel and bridge method in `desktop/bridge.ts` only if the
   renderer needs direct access.
6. Renderer state/UI handling in `desktop/renderer.ts` or React equivalents.
7. Focused tests covering route shape, IPC registration, and renderer behavior.
8. Version bump or compatibility handling if payload changes are breaking.

Do not add a generic `request(path)` bridge to skip this checklist.

---

## Security and Packaging Rules

- The renderer receives no daemon auth token.
- The renderer receives no daemon socket path except as display-only status
  text.
- The renderer cannot request arbitrary local files.
- The renderer cannot run arbitrary shell commands.
- Packaged Desktop lifecycle controls resolve installed or bundled Jin runtime
  capabilities, never repo-local source paths.
- Windows Desktop may only advertise support when the daemon transport exists
  for Windows.

---

## Open Questions

- Should the non-Desktop local query routes become formally versioned, or stay
  compatibility-only until pruned?
- Should Desktop route docs be generated from `src/contracts/desktop.ts`,
  `desktop/bridge.ts`, and `src/api/routes.ts` to prevent drift?
- Should config reload become a first-class Desktop IPC channel, or remain a
  CLI/control API capability until the UI has an explicit reload affordance?
