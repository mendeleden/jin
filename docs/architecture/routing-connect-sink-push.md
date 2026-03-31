# Routing, `connect`, and sink push

**Scope:** How projects are wired to sinks in `config.json`, how `sinksForSession` chooses targets for a session, and when the watcher pushes `PushPayload` rows to Postgres / webhook / S3.

## `jin connect` and `interactiveConnect`

**File:** `src/commands/connect.ts`

- **`connectCommand`** finds or creates a sink (`findOrCreateSink`), then attaches sink IDs to the config via **`setRoute`**.
- **`setRoute`** merges sink IDs into an existing route when the same **project** (case-insensitive), **remote**, or **directory** match already exists; otherwise appends a new `RouteConfig`.
- **`interactiveConnect`** loads **projects from the local store** (`Store.listProjects`) for menus, then loops project → sink selection → `connectCommand`. A **`sinkId`** option can skip sink picking (e.g. after team init).

Sink IDs in routes align with `createSink` in `src/sinks/registry.ts`: explicit `config.id` or `${type}-${index}`.

## Route matching (`src/routing.ts`)

**`sinksForSession(session, store, config, allSinks)`**

1. If **`routeUnmatchedToAll`**: return all instantiated sinks (company opt-in).
2. If **no `routes`**: return **no** sinks — nothing is pushed via this path.
3. Else: for each route in order, for each **project linked to the session** (`store.getSessionProjects(session.id)`), **`matchesRoute`**; **first match wins**. Returned sinks are those whose **`id`** is listed in `route.sinks`.
4. If nothing matches: use **`defaultSinks`** (filter by those IDs), or **none** if unset/empty.

**`matchesRoute(match, project)`**

- **Project:** case-insensitive name equality.
- **Remote:** normalized string equality (e.g. lowercase, strip `.git`, trim slashes) — not glob matching despite comments on `JinConfig` suggesting globs.
- **Directory:** case-insensitive path equality.

Session ↔ project linkage comes from SQLite (`session_projects` / `projects`), exposed as `Store.getSessionProjects`.

## `sink-resolver.ts` vs push routing

**`src/sink-resolver.ts`** is used by **`jin search`** to pick **Postgres** sinks from the current working directory: builds a synthetic `ProjectInfo`, walks routes with the same **`matchesRoute`** idea, then **`defaultSinks`**. It does **not** implement **`routeUnmatchedToAll`** (that flag is only honored in **`sinksForSession`** for the watcher).

## When pushes happen

All of this runs **inside the watch process** (`src/commands/watch.ts`), not as a separate CLI:

1. After **initial ingest** of all active adapters, if sinks passed health check and there are changed sessions.
2. On **debounced** filesystem events (`schedulePush` batches session IDs).
3. On the **periodic** poll interval.
4. On **shutdown** (flush pending set).

If no sinks are healthy, `sinks.length === 0` and pushes are skipped.

## Store → sink: `pushToSinks` and `push_log`

- **`store.sessionsNeedingPush(sink.id)`** — sessions never successfully pushed to that endpoint, or changed since last success (`ingested_at` vs `push_log`).
- For each session, **`sinksForSession`** picks candidate sinks; intersect with “needs push” for that sink.
- **Postgres:** `supportsDelta` + `lastPushedMessageCount` can send only new messages (merge semantics).
- **S3 / webhook:** full message lists per payload (last-write-wins / replace semantics for objects).
- After success, **`store.logPush`** records status (endpoint = sink id).

Sink interface: `src/sinks/types.ts` (`push`, `supportsDelta`). Implementations: `src/sinks/postgres.ts`, `src/sinks/webhook.ts`, `src/sinks/s3.ts`.

## Summary

| Topic | Behavior |
|--------|-----------|
| Wire project → sink | `connect` mutates `config.sinks` + `config.routes` |
| Match priority | `routeUnmatchedToAll` → all; else first matching route × session projects; else `defaultSinks` |
| Push trigger | Watcher: initial ingest, debounced events, periodic poll, shutdown flush |
| Delta vs full | `push_log` + `sessionsNeedingPush`; message delta mainly for Postgres |

## Related tests

`test/connect.test.ts`, `test/routing.test.ts`, `test/search.test.ts`, and integration tests under `test/integration.test.ts` lock in much of this behavior.
