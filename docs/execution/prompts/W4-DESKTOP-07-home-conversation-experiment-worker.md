Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-home-conversation-experiment`.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/blueprint/BP-Product-Strategy.md`

Then execute the reopened W4-DESKTOP-07 experiment.

Current base state:

- The main worktree is intentionally dirty with the latest Home redesign and
  screenshot artifacts. Continue from it. Do not revert those changes unless
  replacing them with a stronger implementation inside the packet.
- Screenshots of the current panels exist under
  `docs/execution/artifacts/W4-DESKTOP-07/current-panels-2026-05-17/`.

Owned files:

- `desktop/components/app-shell.tsx`
- `desktop/styles.css`
- `test/desktop-renderer.test.ts`
- new screenshot/reference artifacts under
  `docs/execution/artifacts/W4-DESKTOP-07/**`
- `.execution/agents/codex-WORKER-desktop-home-conversation-experiment.md`

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

Required product changes:

- Conversations: move filter/search controls into a single compact row at the
  top of the conversation workspace.
- Conversations: metadata must be collapsible and expandable. The collapsed
  state should be obvious, not a goofy `<`/`>` affordance, and expanded metadata
  should feel like a compact drawer/rail rather than a tall page section.
- Home: treat this as an analytics prototype. Make chart surfaces full-width
  where useful and add as many truthful visualizations as can be supported by
  the existing Desktop view model, including day-over-day tokens, day-over-day
  conversations, project activity, adapter mix, estimated cost, and recent
  activity/outlier signals if derivable.
- Home: reduce emphasis on bulky top cards; analytics should dominate the first
  viewport.

Constraints:

- Use existing typed Desktop state only. Do not add daemon IPC endpoints, daemon
  routes, schemas, config, sink/routing behavior, or fake data.
- If a visualization cannot be backed by current data, omit it or label the
  limitation in the completion report. Do not invent values.
- Keep React component rendering. Do not reintroduce legacy HTML adapters or
  `dangerouslySetInnerHTML`.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `git diff --check`
- Capture fresh Home and Conversations screenshots under
  `docs/execution/artifacts/W4-DESKTOP-07/`.

Control plane:

- Create/update
  `.execution/agents/codex-WORKER-desktop-home-conversation-experiment.md`.
- Keep heartbeat/current focus updated while working.
- Do not update packet/program/review files.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
