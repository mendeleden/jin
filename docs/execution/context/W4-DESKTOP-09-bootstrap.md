# Context Capsule: W4-DESKTOP-09

## Goal

- Review and harden the Home dynamic layout implementation already committed
  through `22e2af7`.
- Keep Home layout customization renderer-owned, reversible, and CSP-safe.
- Preserve enough context that workers/reviewers do not have to reconstruct the
  whole conversation.

## Non-Goals

- Do not add daemon, API, IPC, filesystem, config, lifecycle, sink, pipeline, or
  contract changes.
- Do not adopt `react-grid-layout` DOM renderer or CSS.
- Do not move layout persistence from renderer `localStorage` to user-data files
  in this lane.
- Do not customize narrow/mobile breakpoints beyond predictable fallback
  behavior unless explicitly approved.

## Decisions Already Made

- `react-grid-layout` DOM renderer was rejected because it emits inline layout
  styles that conflict with packaged Desktop CSP.
- `react-grid-layout/core` is accepted as a data-only algorithm dependency
  behind `desktop/layout/grid-engine.ts`.
- Renderer `localStorage` is the approved first storage target for Home layout
  preferences.
- Home layout edits require explicit edit mode and explicit Save; Cancel and
  Reset are first-class controls.
- Panels receive deterministic grid-unit context (`w/h` derived density) rather
  than ad hoc DOM measurement for the first implementation.

## Read Manifest

- `docs/execution/tasks/W4-DESKTOP-09-home-dynamic-layout.md` — packet contract.
- `docs/plans/2026-05-23-desktop-dynamic-layouts.md` — step sequence and
  implementation notes.
- `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
  — CSP-safe renderer constraint.
- `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md` —
  RGL DOM rejection and core adapter decision.
- `desktop/layout/grid-engine.ts` — data-only RGL core adapter.
- `desktop/layout/editable-dashboard-grid.tsx` — repo-owned snapped renderer and
  edit handles.
- `desktop/layout/layout-storage.ts`, `desktop/layout/preferences.tsx`,
  `desktop/layout/types.ts` — renderer preference storage.
- `desktop/views/home/layout.ts` — Home panel schema, defaults, and layout
  density context.
- `desktop/views/home/dashboard-grid.tsx` — layout seam and context injection.
- `desktop/views/home/workspace.tsx` — edit/save/cancel/reset toolbar.
- `desktop/views/home/panels.tsx` — layout-aware Home panels.
- `desktop/views/home/token-usage-chart.tsx` — compact/standard/expanded chart
  chrome and heights.
- `test/desktop-layout-engine.test.ts`, `test/desktop-renderer.test.ts`,
  `test/desktop-shell-service.test.ts` — focused evidence.

## Edit Manifest

- `desktop/layout/**` — layout engine, renderer grid, and preference storage.
- `desktop/views/home/**` — Home layout schema, panel adaptation, and controls.
- `desktop/react-renderer.tsx` — provider integration only.
- `test/desktop-layout-engine.test.ts`, `test/desktop-renderer.test.ts`,
  `test/desktop-shell-service.test.ts` — tests for this lane.
- `docs/plans/2026-05-23-desktop-dynamic-layouts.md` — running plan status.
- `.execution/agents/codex-WORKER-home-dynamic-layout.md` — worker heartbeat.

## Known Traps

- The repo currently has unrelated dirty/untracked execution-skill files. Do
  not revert or stage them unless the packet explicitly owns them.
- Recharts props may produce SVG attributes; the forbidden path is adopting the
  RGL DOM renderer/CSS or adding local inline renderer layout styles.
- Compact panel behavior should derive from grid units, not one-off pixel
  measurement.
- `desktop/shell-service.ts`, `desktop/bridge.ts`, `desktop/daemon-client.ts`,
  and `desktop/main.ts` are forbidden for this lane.
- Computer Use now attaches to Electron, but screenshots can be stale relative
  to the accessibility tree during HMR. If resized-state visual validation is
  blocked, record the blocker and rely on static evidence until a stable
  browser/Electron smoke path is available.

## Validation Commands

- `bun run desktop:typecheck`
- `bun test test/desktop-layout-engine.test.ts test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`
- `bun run desktop:build`
- `git diff --check`

## Reviewer Rubric

- Does the implementation keep layout algorithms data-only and CSP-safe?
- Is renderer-local storage defensive and schema-versioned?
- Are edit-mode behaviors explicit, reversible, and absent from normal view
  mode?
- Do compact panel variants prevent clipping/overlap without hiding essential
  meaning?
- Do tests cover engine behavior, renderer boundaries, and layout context?
- Are BP-11 and BP-Product matrix rows backed by code/test evidence?

## Handoff Checklist

- Cite commits reviewed: `0b456da`, `59bc75a`, `22e2af7`.
- Cite validation commands run.
- Fill BP acceptance matrix rows with code/test citations.
- Record V1 comparison as static Home placement becoming explicit edit-mode
  customization while default view remains preserved.
- Record visual validation status, including the current stale screenshot
  blocker for resized-state evidence.
