Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-ui-foundation`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`

Then execute the packet exactly.

Owned files:
- `desktop/**`
- `src/contracts/desktop.ts`
- `src/api/routes.ts`
- `test/desktop-*.test.ts`
- `package.json`
- `bun.lock`
- the packet file only for handoff matrix updates

Forbidden files:
- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/db/**`
- `src/commands/**`
- `src/daemon/**`
- non-Desktop release/install scripts unless Codex explicitly expands scope

You are not alone in the codebase. Do not revert unrelated user or Codex edits.
Adjust to the current dirty workspace, and keep edits inside the packet scope.

Immediate first task:
- run `bun run desktop:typecheck`
- fix the current Desktop compile break before doing any visual polish

Implementation expectations:
- The UI package cut is approved and dependencies are already installed:
  Radix primitives, `lucide-react`, Recharts, `@xyflow/react`, `d3-shape`, and
  `d3-sankey`.
- Home must show a visible mission-control/flow graph surface.
- Routing must show a fluid project-to-sink graph with one visual node per sink.
- Routing should scroll naturally and use available vertical space.
- Do not add Material UI or Three.js.
- Do not add Tailwind or run shadcn CLI in this packet. Use Radix primitives
  directly while the React seam is being established.
- Newly touched complex surfaces should be React components or have a narrow
  typed React component seam. Do not continue growing large HTML string
  templates for Home/Routing graphs.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run typecheck` if shared contracts/routes change

Update `.execution/agents/codex-WORKER-desktop-ui-foundation.md` while working.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
