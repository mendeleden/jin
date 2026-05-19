Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-home-conversation-experiment`.

Review only. Do not edit product files.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/blueprint/BP-Product-Strategy.md`

Then review the current W4-DESKTOP-07 reopened experiment diff.

Write the review artifact to:

- `.execution/reviews/2026-05-17-W4-DESKTOP-07-home-conversation-experiment.md`

Review focus:

- Findings first, ordered by severity.
- Verify Conversations filter/search controls are actually in a compact top row.
- Verify metadata is collapsible/expandable with a clear affordance and does
  not consume excessive vertical space when expanded.
- Verify Home now prioritizes analytics and includes multiple truthful
  visualizations from existing Desktop view-model data.
- Verify no fake data, no new daemon IPC endpoints, no direct DB/file/socket
  reads from the renderer, and no package/lockfile changes.
- Verify static tests were updated for the new surfaces without deleting
  meaningful coverage.
- Verify screenshot artifacts exist for Home and Conversations after the
  experiment.

Evidence to inspect or run:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `git diff --check`
- `rg -n "dangerouslySetInnerHTML|data-legacy-html-view|LegacyHtmlView|legacy-entry|mountDesktopRenderer" desktop scripts test --glob '!dist/**'`

If no findings are found, state that explicitly and list residual UX risks.
