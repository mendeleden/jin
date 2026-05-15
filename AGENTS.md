# Jin for Codex

## Working rules

- Runtime: Bun. Use `bun`, not `npm` or `node`.
- For v2 work, treat `docs/ontology.md` and `docs/blueprint/` as source of truth.
- Packaged Desktop code must not shell out to repo-local Bun or TypeScript entrypoints. Resolve the installed `jin` CLI or a bundled release artifact instead.
- Desktop release matrices, package-script target guards, and `jin desktop` asset candidates must describe the same platform/architecture set.
- If a fix needs behavior that conflicts with a frozen blueprint or contract, stop and surface the drift explicitly before implementing it. Do not hide contract extensions behind duck-typed hooks or packet-local shortcuts.
- Do not add standalone `.mmd` copies of Mermaid diagrams unless they are generated from a current source-of-truth doc or explicitly owned as first-class artifacts.
- Prefer small, typed changes to existing files.
- Run focused validation after changes when practical.
- Prefer `bun run test` over raw `bun test` for broad local validation. The repo runner isolates each `.test.ts` file in a fresh Bun process so top-level `mock.module()` calls cannot leak across files.
- Use `bun run test:integration` for the Docker-backed local Postgres persona test; it is intentionally outside the default unit suite.

## Workflow

Use the repo workflow phases as guidance:

- plan before multi-step work
- review important changes before merge
- compound durable learnings after non-trivial fixes and features

## Compound

When a task reveals a reusable lesson, invoke `$compound` with a short description.

Expected outputs:

- a solution note under `docs/solutions/` when the learning is worth keeping
- small updates to repo instructions or review guidance only when the lesson is durable
- references to related review IDs, packets, or blueprint items when applicable
