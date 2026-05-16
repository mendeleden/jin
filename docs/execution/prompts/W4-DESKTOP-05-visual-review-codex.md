Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-visual-cdp`.

Review only. Do not edit product code.

Goal:
- Use a real browser/CDP-backed visual pass against the current Desktop dev UI.
- Capture screenshots for Home, Routing, and the estimated Cost tooltip.
- Write concrete UI findings that the W4-DESKTOP-05 implementation worker can
  ingest without needing to reproduce your whole session.

Read first:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/packets/W4-DESKTOP-05.md`
5. `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`
6. `docs/execution/prompts/W4-DESKTOP-05-review-codex.md`

Hard boundaries:
- Do not edit `desktop/**`, `src/**`, `test/**`, package manifests, lockfiles,
  blueprints, or product docs.
- You may create files only under:
  - `.execution/reviews/`
  - `.execution/screenshots/`
  - `.execution/agents/codex-REVIEWER-desktop-visual-cdp.md`
  - `/private/tmp`
- If browser/CDP setup is blocked, write a blocker review instead of touching
  product code.

CDP target setup:
- Prefer a real Electron renderer with remote debugging enabled.
- If an existing Desktop dev app is not attachable through CDP, start a
  temporary review-only Desktop target:
  1. run `bun run scripts/build-desktop.ts`
  2. start Vite for `vite.desktop.config.ts` on a localhost port
  3. launch Electron with `--remote-debugging-port=<free-port>` and
     `JIN_DESKTOP_DEV_SERVER_URL=<vite-url>/desktop/index.dev.html`
- Use only localhost targets.
- If Playwright/Puppeteer is already available, you may use it. Do not add it
  to the repo. If it is unavailable, use Bun plus the Chrome DevTools Protocol
  directly from `/private/tmp` scripts.

Screenshots to capture:
- `.execution/screenshots/W4-DESKTOP-05-home.png`
- `.execution/screenshots/W4-DESKTOP-05-routing.png`
- `.execution/screenshots/W4-DESKTOP-05-cost-tooltip.png`

Visual checks:
- Home renders the React shell, not the old static/blank layout.
- Home contains a visible mission-control graph and token/cost observatory.
- Routing renders a project-to-sink graph and uses available height without
  fixed-card clipping.
- Routing project labels stay inside cards, trim `https://github.com/`, and
  expose detail on hover/focus.
- Routing local-only projects say `local only`, not `unrouted`.
- Routing local-only projects do not draw dashed placeholder route legs.
- Routing should not show duplicate section-level Refresh.
- Sidebar has no `Traces` runtime row and no `Next surfaces` filler.
- Sidebar `Cost (estimated)` shows the full cost, is the final runtime metric,
  and uses a real tooltip/popover interaction for the explanatory copy. The
  explanatory sentence must not be always visible inline.
- The left nav collapsed control/icon alignment should be centered.

Write findings to:
- `.execution/reviews/2026-05-16-W4-DESKTOP-05-visual-cdp.md`

Report format:
```md
# W4-DESKTOP-05 Visual CDP Review

Status: pass | findings | blocked

Artifacts:
- Home: .execution/screenshots/W4-DESKTOP-05-home.png
- Routing: .execution/screenshots/W4-DESKTOP-05-routing.png
- Cost tooltip: .execution/screenshots/W4-DESKTOP-05-cost-tooltip.png

Findings:
- [P1/P2/P3] Title — file/component pointer if inferable
  Evidence: screenshot path and concrete visual symptom.
  Suggested worker action: exact behavior to change.

Positive checks:
- ...

Blocked / limits:
- ...
```

Final response:
- Keep it short.
- Include whether screenshots were captured and where the review artifact is.
