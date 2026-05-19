Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-home-graph-cleanup`.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/blueprint/BP-Product-Strategy.md`
9. Current code:
   - `desktop/components/app-shell.tsx`
   - `desktop/styles.css`
   - `src/api/routes.ts`
   - `test/desktop-renderer.test.ts`
   - `test/desktop-home-route.test.ts`

Read the shared control plane first:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W4-DESKTOP-07.md`

Update only your worker heartbeat:

- `.execution/agents/codex-WORKER-desktop-home-graph-cleanup.md`

Owned files:

- `desktop/components/app-shell.tsx`
- `desktop/styles.css`
- `src/api/routes.ts`
- `test/desktop-renderer.test.ts`
- `test/desktop-home-route.test.ts`
- `.execution/agents/codex-WORKER-desktop-home-graph-cleanup.md`

Forbidden files:

- `desktop/graph-components.tsx`
- `desktop/renderer.ts`
- `desktop/react-renderer.tsx`
- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/commands/**`
- `src/daemon/**`
- package manifests and lockfiles
- blueprint docs
- screenshot/image artifacts

Task:

1. Remove the old static SVG fallback from the Home Token Usage chart. The chart should render through Recharts only. Delete unused helpers, constants, CSS, and tests that require `usage-area-static-chart` or `usage-area-static-fill`.
2. Fix chart aggregation so duplicate entries for the same day/month and adapter are combined before display. Monthly callouts/tooltips must not show repeated rows for the same adapter.
3. Make the monthly toggle meaningful by increasing only the existing Desktop Home `tokenUsageByDay` history window in `src/api/routes.ts`. Do not change route names, query parameters, contract fields, or payload shape.
4. Preserve the simplified Home information architecture: Token Usage, Project Activity, and Adapter Mix only. Do not re-add Signals, Recents, Latest conversations, Mission Control, or Open library.
5. Keep the Conversations top-row filter and metadata-collapse work intact unless a test expectation must be adjusted for this graph cleanup.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `git diff --check`
- `rg -n "usage-area-static-chart|usage-area-static-fill|StaticUsageAreaChart|Signals|Recent Activity|Latest conversations|Open library|data-home-flow-graph" desktop/components/app-shell.tsx desktop/styles.css test/desktop-renderer.test.ts`
  - This should return no live implementation references. Negative assertions in tests are acceptable only for removed product labels, not for static chart implementation names.

Do not use Computer Use, Chrome, Browser, screenshot tools, or app UI automation. `codex-BRAIN` owns live visual verification.

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
