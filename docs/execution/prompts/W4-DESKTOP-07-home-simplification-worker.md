Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-home-simplification`.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/blueprint/BP-Product-Strategy.md`

Then execute only the Home simplification cut for W4-DESKTOP-07.

Current base state:

- The main working tree is intentionally dirty with the previous W4-DESKTOP-07
  Home/Conversations experiment. Continue from it.
- Conversations top-row filters and collapsible metadata are already in place.
  Do not redesign Conversations in this lane unless a test requires a narrow
  adjustment.
- Main-thread `codex-BRAIN` owns live Electron inspection and screenshots.
  Do not use Computer Use, macOS UI automation, or screenshot capture from this
  worker.

Owned files:

- `desktop/components/app-shell.tsx`
- `desktop/styles.css`
- `test/desktop-renderer.test.ts`
- `.execution/agents/codex-WORKER-desktop-home-simplification.md`

Forbidden files:

- `src/**`
- `desktop/main.ts`
- `desktop/preload.ts`
- `desktop/daemon-client.ts`
- `desktop/desktop-state.ts`
- package manifests and lockfiles
- blueprint docs
- `.execution/program.md`
- `.execution/packets/**`
- `.execution/reviews/**`
- screenshot/image artifacts

Required product changes:

- Home should be simpler, not richer.
- Remove the `Signals` / `Recent Activity` section from Home.
- Remove the `Latest conversations` / `Recent` panel from Home, including the
  `Open library` button.
- Dedupe repeated Home totals. Sidebar runtime totals can remain global, but
  Home should not repeat the same total in multiple places inside the main
  content.
- Keep one clear primary analytics chart surface.
- Add a period toggle for the primary graph:
  - daily view from the existing daily buckets
  - monthly/rollup view derived client-side from existing daily buckets when
    direct monthly data is unavailable
- Add previous/next controls for the selected graph window. Disable or clearly
  mute unavailable navigation.
- Fix graph readability: labels and values should not be visibly clipped in the
  normal Desktop window. Prefer fewer labels over dense illegible labels.
- Keep project-level and adapter-level rollups only if they complement the
  primary graph and do not restate the exact same KPI set.

Constraints:

- Use existing typed Desktop state only.
- Do not add daemon IPC endpoints, daemon routes, schemas, config, sink/routing
  behavior, or fake data.
- Do not add dependencies.
- Do not reintroduce legacy HTML adapters or `dangerouslySetInnerHTML`.
- If a visualization cannot be backed by current data, omit it or label the
  limitation in the completion report. Do not invent values.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `git diff --check`
- `rg -n "Signals|Recent Activity|Latest conversations|Open library" desktop/components/app-shell.tsx test/desktop-renderer.test.ts desktop/styles.css`
  should only return acceptable negative-test references, if any.

Control plane:

- Create/update
  `.execution/agents/codex-WORKER-desktop-home-simplification.md`.
- Keep heartbeat/current focus updated while working.
- Do not update packet/program/review files.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
