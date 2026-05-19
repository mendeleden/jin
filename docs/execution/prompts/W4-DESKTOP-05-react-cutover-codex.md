Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-react-cutover`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `.execution/packets/W4-DESKTOP-05.md`
7. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
8. `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`
9. Targeted blueprint clauses only:
   - `docs/blueprint/BP-07-process-lifecycle.md`: Desktop is a daemon client;
     one runtime owner; config reload/restart boundaries.
   - `docs/blueprint/BP-08-routing-and-config.md`: routing is pure at push
     time; no route means no push; route visualization must not mutate
     matching semantics.
   - `docs/blueprint/BP-Product-Strategy.md`: Desktop is the personal command
     center and local-first surface over the daemon.
   - `docs/blueprint/BP-11-desktop-daemon-boundary.md`: typed Desktop daemon
     boundary and no renderer-side store scraping.
10. Current code:
    - `desktop/react-renderer.tsx`
    - `desktop/react-entry.tsx`
    - `desktop/renderer.ts`
    - `desktop/graph-components.tsx`
    - `desktop/styles.css`
    - `desktop/bridge.ts`
    - `desktop/shell-service.ts`
    - `src/contracts/desktop.ts`
    - `test/desktop-renderer.test.ts`
    - `test/desktop-shell-service.test.ts`
    - `test/desktop-home-route.test.ts`

Then execute `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`.

Keep reads targeted. Do not dump entire blueprint files or all of
`desktop/renderer.ts`; use `rg` and narrow `sed` windows for the clauses and
helpers needed to implement the cutover.

Primary objective:
- Cut the Desktop shell, sidebar, Home, and Routing surfaces over to real React
  components.
- Stop using `dangerouslySetInnerHTML` for the full app shell in
  `desktop/react-renderer.tsx`.
- Keep Conversations, Logs, and Settings behind an explicit `LegacyHtmlView`
  adapter if converting them would make the diff too broad.

Graph-first execution order:
1. Build React `AppShell`/sidebar/topbar wiring against the existing
   `RendererState`.
2. Make Home render the mission-control graph in the React path.
3. Make Routing render the project-to-sink graph in the React path.
4. Only after those are visible, wire or defer Conversations/Logs/Settings
   through a clearly named legacy adapter.

Do not spend the implementation pass inventorying the whole legacy renderer.
Use targeted reads from `desktop/renderer.ts` for the specific helpers/data
needed by AppShell, Home, Routing, and the legacy adapter.

Preserve these recent W4-DESKTOP-04 behaviors:
- Routing graph project-to-sink legs have fixed width, not weighted thickness.
- Routing project and sink labels are bounded and expose full detail through
  hover/focus detail content.
- Visible project labels trim `https://github.com/`.
- The sidebar runtime card does not show `Traces`.
- `Cost` remains the final sidebar runtime metric row.
- The sidebar runtime Cost row shows the full formatted dollar amount, not a
  compact/truncated value.
- The sidebar runtime Cost row is labeled as estimated and has a small info
  affordance with hover/focus copy explaining the value is calculated from API
  pricing estimates and is not subscription usage or billing-plan spend.
- The estimated-cost explanation must be a real React tooltip/popover-style
  interaction, preferably Radix Tooltip or a shadcn-style wrapper over it. Do
  not render that explanatory sentence as always-visible inline copy.
- The left sidebar no longer renders the `Next surfaces` placeholder panel or
  its `Search`, `Projects`, and `Health` filler items.
- Routing does not render a duplicate section-level Refresh button; the shell
  Refresh remains.
- Routing local-only projects use the wording `local only`, not `unrouted`, and
  the graph does not draw dashed placeholder legs for local-only projects.

Implementation boundaries:
- Edit only files allowed by `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`.
- Do not edit `src/api/**`, `src/contracts/**`, routing semantics, sinks,
  pipeline, DB, commands, daemon, adapters, release/install scripts, blueprint
  docs, package manifests, or lockfiles.
- Do not add packages.
- Do not revert unrelated dirty workspace changes.
- If a daemon API or contract change seems needed, stop and return `needs Codex`
  instead of implementing it.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build` if the entry/build surface is touched

Update `.execution/agents/codex-WORKER-desktop-react-cutover.md` while working.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
