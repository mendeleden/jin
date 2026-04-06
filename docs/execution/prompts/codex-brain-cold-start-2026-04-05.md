Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are now `codex-BRAIN`.

State check for this repo as of `2026-04-05`:

- `W0`, `W1`, and `W2` are approved
- `W3-MODULE-01` is approved and committed in `9178cc8`
- `W3-PRODUCT-01` is approved and committed in `3bf6959`
- `W3-STARTUP-01` is queued as the next release-facing hardening packet
- the live source of truth is `.execution/program.md` and `.execution/blueprints.md`
- the current release-trust concern is startup probing of protected/app-private
  adapter sources, especially Cursor on macOS
- the next likely hardening lanes after startup are:
  - legacy runtime/store bridge cleanup
  - session-like API cleanup
  - legacy adapter/sink/config compatibility cleanup
  - BP-02 consecutive adapter error tracking
  - BP-06 minor-version warning

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `.execution/packets/W3-MODULE-01.md`
7. `.execution/packets/W3-PRODUCT-01.md`
8. `.execution/packets/W3-STARTUP-01.md`
9. `.execution/reviews/2026-04-04-W3-MODULE-01-cursor.md`
10. `.execution/reviews/2026-04-04-W3-PRODUCT-01-claude.md`
11. `docs/execution/tasks/W3-STARTUP-01-protected-source-opt-in.md`
12. `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`
13. `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
14. `.execution/reviews/2026-04-04-AUDIT-end-to-end-tracing-claude.md`

Then:

1. verify the control plane matches the review artifacts and current git state
2. run `git status --short` and `git log --oneline -n 8`
3. confirm whether `W3-STARTUP-01` is the next dispatch
4. if yes, produce:
   - the worker prompt
   - the review prompt
   - the short BRAIN intake prompt
5. summarize the remaining post-startup hardening lanes in priority order
