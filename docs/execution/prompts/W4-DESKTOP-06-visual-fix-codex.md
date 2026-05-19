# W4-DESKTOP-06 Visual Fix Worker

You are the follow-up worker for `W4-DESKTOP-06`.

Read first:

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- `docs/execution/tasks/W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`
- `.execution/reviews/2026-05-16-W4-DESKTOP-06-computer-use-visual.md`

Scope:

- Fix only the visual blockers found by Computer Use:
  - Home graph panels visually collapsed / too short.
  - Sidebar `Cost (estimated)` info popup not visibly opening in Electron.
- Keep the existing React cutover.
- Do not change daemon APIs, IPC contracts, config, routing semantics, sink logic, or package dependencies.
- Prefer targeted edits to:
  - `desktop/components/app-shell.tsx`
  - `desktop/styles.css`
  - `test/desktop-renderer.test.ts`

Required behavior:

- Home must show real graph content for Mission Control and Token & Cost Observatory at visible height in the first viewport.
- The visual layout must not render graph panels as thin header-only strips.
- Sidebar `Cost (estimated)` must open a visible popup on click/focus in Electron.
- It is acceptable to replace the Radix Tooltip with Radix Popover for this control if that is more reliable.
- The help text must not be always-inline under the label; it must be discoverable through the `(i)` control.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `rg -n "dangerouslySetInnerHTML|data-legacy-html-view|LegacyHtmlView|legacy-entry|mountDesktopRenderer" desktop scripts -g '!**/dist/**'` should return no hits.

Update:

- `.execution/agents/codex-WORKER-desktop-visual-fix.md`

Final answer must list:

- Files changed.
- Tests run.
- How each visual blocker was fixed.
- Any residual risk that still needs live Computer Use review.
