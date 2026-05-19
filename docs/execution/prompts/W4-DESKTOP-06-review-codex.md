Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-full-react-cutover`.

Review only. Do not edit product files.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-06.md`
6. `docs/execution/tasks/W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`
7. `docs/blueprint/BP-07-process-lifecycle.md`
8. `docs/blueprint/BP-08-routing-and-config.md`
9. `docs/blueprint/BP-Product-Strategy.md`
10. `docs/blueprint/BP-11-desktop-daemon-boundary.md`

Then review the current diff for W4-DESKTOP-06.

Write the review artifact to:

- `.execution/reviews/2026-05-16-W4-DESKTOP-06-review-codex.md`

Review focus:

- Findings first, ordered by severity.
- Verify `LegacyHtmlView`, `dangerouslySetInnerHTML`, and full-view legacy HTML
  rendering are gone from Desktop source.
- Verify Conversations, Logs, and Settings are React components, not raw HTML
  injection.
- Verify Home Token & Cost Observatory renders a populated chart both for real
  `tokenUsageByDay` data and snapshot-derived fallback data.
- Verify the sidebar `Cost (estimated)` `(i)` popup is actually usable in the
  live React/Electron path: hover/focus opens visible content, the content is
  not clipped by sidebar overflow, and the explanation is not always-visible
  inline text.
- Verify no renderer direct access to SQLite, files, sockets, auth tokens, or
  daemon internals.
- Verify no forbidden daemon/API/contract/routing/pipeline files were modified.
- Verify BP Acceptance Matrix and V1 Comparison are complete.

Run or inspect evidence for:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `rg -n "dangerouslySetInnerHTML|data-legacy-html-view|LegacyHtmlView" desktop --glob '!**/dist/**'`
- `rg -n "legacy-entry|mountDesktopRenderer" desktop scripts test --glob '!**/dist/**'`

If no findings are found, state that explicitly and list residual risks or
visual verification gaps.
