# API and dashboard read path

**Scope:** How the local HTTP server exposes SQLite-backed data, and how the Vite dashboard consumes it.

## Server bootstrap

**File:** `src/api/server.ts`

- **`loadConfig()`** then **`new Store(config.store.dbPath)`**.
- **`createRoutes(store)`** from `src/api/routes.ts` — handlers use the **store only** (not the full config object for business logic).
- PID / port / log files for the UI process live under **`configDir()`** (e.g. `ui.pid`, `ui.port`, `ui.log`).

## HTTP API (`src/api/routes.ts`)

Routes are matched via `matchRoute(routes, method, pathname)` for paths under `/api/`.

Representative **GET** endpoints (all read from `Store`):

| Path | Purpose |
|------|---------|
| `/api/overview` | Aggregate counts, tokens/cost by adapter |
| `/api/sessions` | Query: adapter, since, limit, project, tag, search |
| `/api/sessions/:id` | Session detail, messages, tags, tree |
| `/api/analytics/timeline` | `timelineByDay` |
| `/api/analytics/adapters` | `analyzeByAdapter` |
| `/api/analytics/models` | `analyzeByModel` |
| `/api/analytics/tools` | `analyzeToolUsage` |
| `/api/analytics/projects` | `costByProjectAndTool` |
| `/api/projects` | `listProjects` |
| `/api/projects/:id/sessions` | Sessions for a project |
| `/api/tags` | `listTags` |
| `/api/artifacts`, `/api/artifacts/:id` | Artifact listing / lookup |

**SSE:** `GET /api/feed` in `server.ts` — `text/event-stream` for live events (`session_created`, `message_added`, etc.).

**Static / dev:** CORS on `/api`. In dev mode, non-API requests may proxy to Vite; production serves the embedded SPA for client-side routing.

## Dashboard (`dashboard/`)

**`dashboard/src/lib/api.ts`**

- Base URL: `import.meta.env.VITE_API_URL || ""` (empty = same origin).
- `fetch(`${BASE_URL}${path}`)` wrappers: `fetchOverview`, `fetchSessions`, `fetchSession`, analytics, projects, tags, artifacts.

**`dashboard/vite.config.ts`**

- Dev proxy: `/api` → `http://localhost:4000` (Bun API server default port).

**`dashboard/src/App.tsx`**

- Routes: `/`, `/sessions`, `/sessions/:id`, `/analytics`, `/projects`, `/artifacts`, `/feed`.

**Session-heavy pages**

| Page | Data source |
|------|-------------|
| `pages/Dashboard.tsx` | `fetchOverview`, `fetchTimeline`, `fetchSessions` |
| `pages/Sessions.tsx` | `fetchSessions` with filters |
| `pages/SessionDetail.tsx` | `fetchSession(id)`, `MessageThread` |
| `pages/Projects.tsx` | `fetchProjectSessions` when a project is selected |
| `pages/Feed.tsx` | `EventSource` to `/api/feed` (not via `lib/api.ts`) |

React Query is configured in `main.tsx` (stale time, refetch on focus).

## End-to-end read path

1. API server: `loadConfig` → `Store(dbPath)` → `createRoutes(store)`.
2. Each handler calls `Store` methods and returns JSON.
3. Dashboard: `lib/api.ts` fetch to same host or `VITE_API_URL`; dev uses Vite proxy to port 4000.
4. Live updates: **Feed** page subscribes to SSE.

## Related

- Watcher and push logic are **not** in the API layer; they run in `jin start` (`src/commands/watch.ts`).
- Dashboard is read-only over HTTP; mutations happen through the CLI / filesystem / daemon, not through these routes.
