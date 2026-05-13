---
title: "PRD: Jin Desktop"
status: draft
created: 2026-04-17
depends-on:
  - docs/ontology.md
  - docs/blueprint/BP-Product-Strategy.md
  - docs/blueprint/BP-07-process-lifecycle.md
  - docs/blueprint/BP-08-routing-and-config.md
  - docs/proposals/unix-socket-daemon-boundary.md
  - docs/execution/tasks/W4-DESKTOP-01-daemon-query-boundary.md
informs:
  - future Desktop UI/client packets
  - external mockup generation for Jin Desktop
---

# PRD: Jin Desktop

## 1. Summary

Jin Desktop is the native personal command center for the local Jin runtime.

It gives developers a high-signal place to:

- see whether Jin is running and healthy
- browse and search local conversations
- inspect traces, compaction chains, and spawned sub-agents
- understand adapter, model, token, and sink activity
- control the daemon without opening a terminal

Jin Desktop is a surface over the daemon. It is not a second backend, a second
ingestion engine, or a replacement for the canonical local store.

The approved `W4-DESKTOP-01` packet delivered the daemon-hosted query boundary.
This PRD defines the full Desktop product that should sit on top of that
boundary.

---

## 2. Problem

Today Jin has strong local ingestion and read surfaces, but they are split
across CLI commands and low-level status output:

- the user can browse data from the CLI, but not through a persistent native UI
- trace relationships and spawned sub-agents are hard to scan quickly in text
- runtime state, ingest progress, sink issues, and search results are available,
  but not composed into one coherent product surface
- the old browser/TUI dashboard was removed on purpose, leaving a clean product
  gap for a real Desktop app

The result is that Jin already knows a lot, but it is still too hard to answer
questions like:

- What happened in my coding sessions today?
- Which agent or sub-agent produced this result?
- Why is Jin degraded right now?
- Which project or adapter is generating the most activity?
- Is the daemon healthy enough that I can trust the local index?

Jin Desktop should solve that without violating the approved product and
lifecycle boundaries.

---

## 3. Product Position

### Within the Jin family

- Jin Daemon is the canonical local runtime and source of truth.
- Jin Desktop is the primary personal local interface.
- Jin Team is the remote workspace product.
- Generic sinks remain integrations, not the Desktop's backend model.

### Core positioning

Jin Desktop is not a general analytics dashboard and not a terminal wrapper.
It is a local developer workbench for understanding AI coding activity and Jin
runtime health.

### Product promise

> If Jin is running on your machine, Desktop is the fastest way to understand
> what your agents did, what Jin indexed, and whether the local runtime is
> healthy.

---

## 4. Product Principles

### 1. Local-first

The primary value must exist before Team, cloud, or shared infrastructure.

### 2. Daemon-client only

Desktop must consume the daemon boundary. It must not add:

- a second coordinator
- a second watcher
- direct process ownership logic outside the lifecycle boundary
- a second canonical data path

### 3. Conversation-first

The canonical object in the UI is the conversation, with messages, tool calls,
trace relationships, and spawned children layered around it.

### 4. Trace-aware by default

Jin's differentiator is not just "show me sessions." It is "show me the shape
of related work" including compaction chains, forks, and spawned sub-agents.

### 5. Calm, dense, operational

The UI should feel like a serious developer tool:

- dense enough for daily use
- readable at long durations
- rich in structure and filtering
- explicit about runtime state

It should not feel like a marketing dashboard or a resurrected browser-era SPA.

### 6. Progressive disclosure

The top level should answer "what is happening?" quickly. Deeper screens should
answer "why?" without forcing users into raw JSON unless they ask for it.

---

## 5. Goals

### Primary goals

- Make Jin status legible without a terminal.
- Make local conversations browsable and searchable in a native app.
- Make traces, spawned conversations, and compaction relationships easy to
  inspect visually.
- Give developers confidence that Jin is healthy and indexing correctly.
- Provide a stable UI contract that can evolve without changing daemon/store
  ownership.

### Secondary goals

- Reduce the number of times a user opens the CLI for read-only inspection.
- Give a clearer product surface for demoing Jin personal mode.
- Create a clean foundation for later team and live-event surfaces.

---

## 6. Non-Goals

The first real Desktop product must not:

- become a second runtime or coordinator
- own parsing, ingestion, storage, or routing logic
- restore the removed browser/TUI/dashboard stack
- require direct SQLite scraping as its primary data contract
- become the primary configuration editor for all routes and sinks
- include Team admin, schema apply, or workspace provisioning flows
- include a terminal emulator, agent composer, or prompt-running surface
- imply that Desktop is required for Jin to be useful

Also explicitly out of scope for the first Desktop release:

- Windows transport parity if it requires named-pipe work not yet landed
- write-capable queue actions beyond lifecycle control unless daemon command
  endpoints are added later
- collaborative/multi-user Team surfaces

---

## 7. Target Users

### Primary user: individual developer

Traits:

- uses one or more AI coding tools daily
- wants a persistent local history and search surface
- wants to understand traces, sub-agents, and cost/activity without SQL

Primary questions:

- What did I work on?
- Which session matters?
- What happened in this trace?
- Is Jin healthy?

### Secondary user: team-connected developer

Traits:

- also routes local data to Team or other sinks
- needs local confidence before caring about remote visibility

Primary questions:

- Is local ingest healthy?
- Are sinks enabled and not degraded?
- Did this project's data get indexed locally before it pushes anywhere else?

### Tertiary user: demo/reviewer

Traits:

- evaluating Jin's product shape
- wants a fast, polished representation of local value

Primary questions:

- What does Jin know?
- Why is Desktop useful beyond the CLI?

---

## 8. User Jobs To Be Done

### JTBD 1: Daily review

"When I have been coding with agents all day, I want to open one app and see
the important conversations, projects, and traces from today so I can remember
what happened."

### JTBD 2: Investigate a result

"When I know a conversation exists but I cannot remember its ID or exact tool,
I want to search by phrase, file, adapter, project, or time range and jump into
the right conversation."

### JTBD 3: Inspect a trace

"When work spans compactions or spawned sub-agents, I want to see the tree and
timeline clearly so I can understand the full chain."

### JTBD 4: Trust the runtime

"When Jin seems stale or wrong, I want Desktop to tell me if the daemon is
stopped, degraded, paused, or healthy and what path or component is involved."

### JTBD 5: Start from zero

"When Jin is not running, I want Desktop to tell me that clearly and let me
start it without switching contexts."

---

## 9. Release Scope

## 9.1 Phase 1: Desktop foundation

This is the first real Desktop release and should be designed around the
currently approved daemon/query boundary.

Required in Phase 1:

- native app shell
- daemon status and lifecycle controls:
  - status
  - start
  - stop
  - restart
- home/overview screen
- conversations list and filters
- full-text search
- conversation detail screen
- trace view
- tree view
- projects screen
- health/status screen
- read-only analytics modules based on existing query routes
- explicit empty, stopped, degraded, and loading states

Not required in Phase 1:

- real-time event streaming
- in-app sink editing
- in-app route editing
- daemon work-queue actions like reingest/pause sink
- Team-authenticated workspace UI
- offline read mode when daemon is stopped

## 9.2 Phase 2: Live and operational enhancements

Potential follow-on scope once the daemon boundary supports it cleanly:

- live event stream instead of poll-heavy refresh
- ingest progress streaming
- queue/backlog visibility
- per-sink recent delivery history
- notifications for degraded/paused states
- quick actions like "reingest adapter"

## 9.3 Phase 3: Team-aware local Desktop

Later, and only if Team product work justifies it:

- workspace identity display
- local-to-Team sync visibility
- remote handoff/status summaries

This remains additive. Desktop still starts as a local-first product.

---

## 10. Supported Platforms

### Initial platform target

- macOS
- Linux

### Deferred platform

- Windows, after a stable Windows daemon transport exists

### Packaging

- Electron app
- one installed app per local user
- app may bundle or discover the local `jin` binary, but must not become the
  canonical runtime owner itself

---

## 11. System Boundary And Data Contract

## 11.1 Runtime ownership

Desktop must respect BP-07:

- one long-lived runtime owner per local store
- Desktop is a client of the daemon boundary
- Desktop may request lifecycle actions, but not bypass ownership checks

## 11.2 Primary transport

Desktop should consume the deterministic local daemon boundary delivered by
`W4-DESKTOP-01`.

For product planning, assume:

- lifecycle and status go through the local control boundary
- read queries go through the daemon-hosted query server
- the app does not need direct SQLite knowledge for its primary product path

## 11.3 Refresh model

Phase 1 should assume request/response plus polling where needed.

Required behavior:

- status refresh on app launch
- status refresh on screen focus and manual refresh
- lightweight periodic polling for runtime state while the app is open
- query refresh on navigation, filter changes, and explicit refresh

Do not require a live event stream for the first release.

## 11.4 Behavior when daemon is absent

When the daemon is not running:

- Desktop must show a clear stopped state
- Desktop may offer a `Start Jin` action
- Desktop must not silently create a hidden second runtime

Phase 1 assumption:

- primary browsing/search experience requires the daemon to be running
- "browse local data while daemon is stopped" is a later decision, not a
  foundation requirement

---

## 12. Core Information Architecture

The app should be organized around five top-level areas:

1. Home
2. Conversations
3. Search
4. Projects
5. Health

Settings may exist, but should remain light in Phase 1.

### Global shell elements

- left navigation rail or sidebar
- top bar with:
  - global search entry
  - runtime status badge
  - project/time filter context when relevant
  - refresh action
- main content area
- optional right context panel for metadata/related items

The shell should make the current runtime state visible from every screen.

---

## 13. Screen Specifications

## 13.1 App Shell

### Purpose

Provide persistent navigation and runtime context.

### Required elements

- app title / workspace identity for personal mode
- primary navigation
- runtime badge:
  - running
  - degraded
  - starting
  - stopping
  - stopped
- universal search entry point
- refresh action
- clear stopped/degraded treatment without modal spam

### Interaction rules

- global search is accessible from all screens
- the runtime badge is clickable and opens Health
- long-running loading states should use inline skeletons rather than blocking
  modal overlays

---

## 13.2 Home

### Purpose

Answer "what is happening?" in one glance.

### Required modules

- runtime status summary
- today's conversations count
- recent activity timeline
- top projects
- top adapters
- recent degraded issues, if any
- quick links:
  - recent conversations
  - searches
  - projects with most activity

### Required cards/content

- runtime card:
  - state
  - mode
  - uptime
  - socket path
  - start/stop/restart action
- activity summary:
  - conversations
  - messages
  - tokens
  - cost
  - traces
- recent conversations list:
  - title
  - adapter
  - relative time
  - project
  - trace/sub-agent indicator
- issue summary:
  - degraded components
  - paused sinks
  - ingest progress if present

### Empty states

- stopped daemon
- running but no conversations yet

---

## 13.3 Conversations

### Purpose

Be the primary browsing surface for the local library.

### Required capabilities

- list conversations in reverse chronological order
- filter by:
  - adapter
  - time range
  - project
- optional text filter integrated with global search
- limit/pagination or infinite scroll
- row affordances for:
  - trace membership
  - spawned children
  - compaction relationship

### Conversation row content

- title
- adapter
- project / git remote
- model
- started time
- relative duration
- message count
- token/cost summary when available
- relationship chips:
  - root
  - compacted
  - spawned
  - forked

### Preferred layout

A split layout is preferred:

- left: filters
- center: conversation list
- right: preview pane or metadata summary

If the mockup system handles navigation more cleanly with a dedicated detail
page, that is acceptable. The key requirement is fast scan + fast jump.

---

## 13.4 Search

### Purpose

Find relevant conversations from raw text memory, not just IDs.

### Required capabilities

- full-text search over conversation/message content
- filters by:
  - adapter
  - time range
- explicit query box with submit and clear
- results grouped by conversation, with message snippets

### Result row content

- conversation title
- matching snippet
- adapter
- project
- timestamp
- count of matches in that conversation, if available

### Required actions

- open conversation at the matching message
- refine search
- clear filters

### Empty states

- no query entered
- no results

---

## 13.5 Conversation Detail

### Purpose

Make one conversation inspectable without dropping to raw storage.

### Required header content

- conversation title
- adapter
- project / cwd context
- model
- started/ended time
- duration
- token/cost totals
- relationship type
- trace ID

### Required sections

- message timeline
- tool call visibility inline with messages
- metadata summary
- related conversations summary:
  - parent
  - children
  - trace size

### Message timeline requirements

- preserve role distinction:
  - user
  - assistant
  - system
- render long content legibly
- show tool calls in place or as expandable blocks
- show timestamps and turn structure
- support jumping to search hit anchors

### Optional tabs for mockups

- `Timeline`
- `Trace`
- `Tree`
- `Metadata`

This is the preferred shape because it cleanly maps to existing daemon-backed
detail, trace, and tree semantics.

---

## 13.6 Trace View

### Purpose

Show all conversations related by trace in a legible, navigable way.

### Required capabilities

- show all conversations in the trace
- show relationship type for each node
- make the current conversation obvious
- make parent/child relationships obvious

### Required representation

At minimum:

- ordered trace list with structure

Preferred:

- hybrid view with:
  - structural tree or graph on one side
  - selected node details on the other

### Required node metadata

- title
- relationship
- adapter
- start time
- message count

---

## 13.7 Tree View

### Purpose

Make spawned sub-agents and compaction branches visually understandable.

### Required capabilities

- tree layout rooted at the root conversation
- selected node state
- expand/collapse if needed
- jump from node to detail

### Design requirement

This view should feel like a first-class Jin differentiator, not an afterthought.
It is one of the clearest reasons for a Desktop UI at all.

---

## 13.8 Projects

### Purpose

Give a project-oriented view across conversations.

### Required capabilities

- list known projects/remotes
- show per-project activity counts
- show recent conversation activity
- click into project detail

### Project detail should show

- project identity
- recent conversations
- adapter mix
- token/cost summary
- latest activity

This screen should help answer:

> Which repos are generating activity, and what happened in each?

---

## 13.9 Health

### Purpose

Be the operational surface for local confidence in Jin.

### Required modules

- runtime summary
- component status
- issue list
- sink state summary
- config/store/log/socket paths
- ingest progress when present

### Required actions

- start
- stop
- restart
- open logs/config folder if the platform shell supports it later

### Required issue treatment

- distinguish healthy vs degraded vs paused
- make issue subsystem explicit
- show enough detail to explain why state is degraded

### Important product rule

Health is not a raw dump. It should be structured for actionability.

---

## 13.10 Settings

### Purpose

Hold low-frequency app preferences, not daemon internals.

### Phase 1 scope

- theme preference
- polling cadence preference, if exposed
- launch-on-login preference only if the install story supports it cleanly

### Not Phase 1

- full sink config editing
- route editing
- direct Team schema/admin controls

---

## 14. Key States And UX Rules

## 14.1 Stopped state

When the daemon is stopped:

- the app shell still renders
- Home and Health clearly indicate stopped status
- primary CTA is `Start Jin`
- data-heavy screens may be disabled or replaced with a clear explanation

Suggested copy:

> Jin is not running. Start the daemon to browse live local conversations and
> health data.

## 14.2 Starting state

- show active startup state immediately after user action
- avoid duplicate start attempts
- if startup fails, route the user to a clear error state with logs/path context

## 14.3 Degraded state

- show persistent degraded badge in shell
- summarize issue count and subsystem
- keep browsing available unless the daemon itself is unavailable

## 14.4 Empty library state

If Jin is running but no data exists:

- explain what Jin is waiting for
- remind the user which adapters are active
- suggest using their AI tools normally

## 14.5 Loading state

- use skeletons for list/detail content
- do not freeze shell navigation
- preserve previous content during refresh where possible

---

## 15. Canonical UI Vocabulary

Use these labels in the product:

- `Conversations` as the primary library term
- `Trace` for all related conversations sharing a trace
- `Tree` for parent/child relationship visualization
- `Projects` for git remotes / repo-level grouping
- `Health` for runtime and component state

Avoid leading with legacy labels like `sessions` in the user-facing product
unless needed for compatibility copy.

---

## 16. Functional Requirements

## 16.1 Lifecycle

Desktop must be able to:

- read local runtime status
- trigger start
- trigger stop
- trigger restart

Desktop must not:

- bypass lifecycle ownership checks
- spawn duplicate long-lived owners

## 16.2 Querying

Desktop must be able to retrieve:

- overview summary
- conversations list
- search results
- conversation detail
- trace view
- tree view
- project summaries
- analytics summaries already exposed by the daemon/query layer

## 16.3 Search and navigation

Desktop must support:

- keyboard-focused search entry
- deep-linkable or restorable navigation state inside the app
- opening a conversation from any relevant list or result surface

## 16.4 Runtime clarity

Desktop must always make it obvious whether Jin is:

- stopped
- starting
- running
- degraded
- stopping

## 16.5 Phase 1 boundary mapping

Phase 1 mockups and implementation should assume the following approved local
data/control surfaces exist today:

- Home / Health:
  - `GET /api/control/status`
  - `POST /api/control/start`
  - `POST /api/control/stop`
  - `POST /api/control/restart`
  - `GET /api/overview`
- Conversations:
  - `GET /api/conversations`
  - `GET /api/conversations/:id`
- Search:
  - `GET /api/search`
- Trace / Tree:
  - `GET /api/conversations/:id?view=trace`
  - `GET /api/conversations/:id?view=tree`
- Projects:
  - `GET /api/projects`
  - `GET /api/projects/:id/conversations`
- Analytics modules:
  - `GET /api/analytics/timeline`
  - `GET /api/analytics/adapters`
  - `GET /api/analytics/models`
  - `GET /api/analytics/tools`

Anything that requires live event streaming, in-app daemon work-queue mutation,
or rich Team state should be designed as future-facing and clearly marked as
post-Phase-1 in the mockups.

## 16.6 Contract model

Desktop should treat the v2 ontology/domain model as the canonical entity
surface for core local data.

That means future typed Desktop work should reuse the existing v2 data objects
for canonical entities where possible:

- `Conversation`
- `Message`
- `ToolCall`
- push-state/store entities such as `PushStateRecord` when that data is exposed

Desktop work should not create a parallel type universe just to wrap those same
entities again.

However, some daemon responses are not single ontology entities. They are
composed views for a product surface. Those should still use explicit boundary
contract types, for example:

- overview summary
- conversation detail with parent, children, and messages
- trace view with both the reconstructed tree and per-conversation message sets
- tree view
- local control/status responses

Phase 1 Desktop work should also drop v1 compatibility shaping in the new app
surface:

- no `parentSessionId`
- no mixed snake_case and camelCase aliases in the Desktop-facing contract
- no Desktop dependency on legacy session naming

The guiding rule is:

> reuse v2 entity types directly for canonical objects, and define explicit
> contract types only for composed daemon/Desktop views.

---

## 17. Quality Requirements

These are product-level targets, not strict benchmark gates.

- App feels launchable as a daily tool, not a heavy demo shell.
- Primary screens are readable at laptop sizes without wasting large amounts of
  space.
- Large conversation lists and long timelines should remain usable.
- Search should feel immediate enough for iterative refinement.
- State changes such as stop/start should feel explicit and trustworthy.

For mockup purposes, the visual bias should be:

- information-dense
- native-desktop
- developer-tool serious
- restrained, not flashy

Avoid:

- giant KPI hero cards as the whole product
- glossy browser-dashboard tropes
- "AI assistant app" aesthetics that hide structure

---

## 18. Mockup Handoff Requirements

This PRD should drive a mockup pack with at least these screens:

1. App shell + Home in healthy/running state
2. App shell + Home in stopped state
3. Conversations library with filters
4. Search results screen
5. Conversation detail timeline
6. Trace view
7. Tree view
8. Health screen in degraded state
9. Projects screen

Use the companion mock-data pack at [docs/jin-desktop-stitch-mock-data.md](/Users/edenmendel/Documents/GitHub/jin-desktop/docs/jin-desktop-stitch-mock-data.md:1)
for realistic sample content and metrics derived from the live SQLite graph.

### Mockup fidelity guidance

The mockups should show:

- realistic developer data density
- explicit runtime badges and issue states
- trace relationships as a core feature
- clear local-first identity
- no browser-era dashboard metaphors

The mockups should not assume:

- collaborative Team UI
- write-capable daemon queue controls
- Windows parity
- a second runtime hidden inside Desktop

---

## 19. Future Expansion Areas

These are intentionally not part of the foundation release, but the IA should
not block them:

- saved searches
- live event stream timeline
- recent ingest/push activity feed
- sink delivery history
- annotations/bookmarks
- Team-linked project/workspace context
- richer adapter/model analytics

---

## 20. Open Questions

These should be reviewed before implementation begins:

1. Should Desktop Phase 1 require the daemon to browse all data, or should it
   offer direct read-only fallback when the daemon is stopped?
2. Should `Search` remain a top-level nav item, or should global search be the
   primary entry point with a results mode only?
3. Should conversation detail default to a split inspector layout or a tabbed
   workbench layout?
4. How much of the analytics surface belongs on Home versus separate secondary
   pages later?
5. When Windows support arrives, do we want the same exact IA for parity, or a
   later platform-specific rollout?

---

## 21. Recommended Implementation Sequence

If we build against the currently approved daemon boundary, the cleanest order
is:

1. Electron shell + runtime connection bootstrap
2. Home + Health using status/control/overview
3. Conversations list
4. Search
5. Conversation detail
6. Trace + Tree
7. Projects
8. UX polish, empty states, degraded states, keyboard flow

This keeps the first usable slices aligned to the existing daemon contract.

---

## 22. Bottom Line

Jin Desktop should be the native local workbench for understanding AI coding
activity and Jin runtime health.

It should feel more like an observability-grade developer tool than a generic
dashboard, and it must stay rigorously downstream of the daemon boundary.

The product bet is simple:

> Daemon owns truth. Desktop makes that truth legible.
