# Prompt 04: Project Atlas

Generate a detailed desktop app mockup for Jin Desktop Home as a "Project Atlas".

Jin product context: Jin is a local daemon and desktop viewer for AI coding conversations. It ingests conversation data from Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future adapters, then normalizes everything into a single SQLite store. Jin understands project identity through git remote, branch, cwd, source path, adapter, model, conversation trace, parent/child/fork relationships, messages, tool calls, tokens, cost, and sink delivery state. The Home page should help a developer see which repositories are active and how AI work is distributed across them.

Subject: a project-centric atlas of AI coding activity.

Action: map repositories and branches by AI-assisted development activity, with drill-down affordances into conversations and traces.

Location/context: native Electron desktop window, dark local-first UI, full-height left sidebar with Home selected. Runtime card shows the local daemon is running and reading from the SQLite store.

Composition: 16:10 screenshot, straight-on UI capture. Main hero panel title: "Project Atlas". Create a central grid/map of repository tiles. Tile size represents conversation count. Tile border color represents runtime/sink health. A tiny sparkline inside each tile shows recent conversation volume. Small badges show adapter mix and token spend. Use concrete repository examples such as "github.com/mendeleden/jin", "github.com/acme/earlywarning", "local/private-prototype", and "github.com/team/infra-tools".

Supporting panels:

- "Active Branches": branch names, recent messages, adapter.
- "Tool-Call Hotspots": files or projects with many Read/Grep/Bash/Edit calls.
- "Recent Repos": latest touched git remotes.
- "Longest Running Traces": trace duration and child count.
- "Delivery Coverage": routes to team-postgres and S3 archive.

Style: native developer cockpit, data-dense, calm, precise. Use dark graphite base, deep blue panels, green/amber status colors, and subtle map-like geometry. Keep text sharp and meaningful. Make the repository atlas feel interactive: hover states, selected project drawer, visible drill-in arrows, and compact filters.

Text rendering requirements: render exact labels "Project Atlas", "Active Branches", "Tool-Call Hotspots", "Delivery Coverage", "team-postgres", "Claude Code", "Codex", "Cursor", "Gemini CLI", "SQLite Store".

Camera/visual control: front-on product screenshot, 2K clarity, no illustrative characters, no generic analytics stock UI.

