# Prompt 08: Spatial Work Graph

Create an ambitious but implementable concept mockup for Jin Desktop Home using a spatial work graph visual language.

Jin product context: Jin is a local observability layer for AI coding work. It ingests conversations from Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future coding agents into a single normalized SQLite store. It tracks conversations, messages, tool calls, trace IDs, root/spawned/forked/compacted lineage, projects, branches, local paths, models, token usage, estimated cost, runtime logs, config reloads, routes, sinks, Postgres/S3 delivery, and team/user export metadata. Jin Desktop is a daemon-backed Electron UI with Home, Conversations, Logs, and Settings.

Subject: a spatial, high-signal Home page that combines work graph, live event tape, and insight drawer.

Action: make the developer feel they can navigate all local AI coding activity as a living system.

Location/context: native macOS desktop window, full-height left control rail, dark serious theme. Home is selected. The screen is a static mockup of an interactive product.

Composition: 16:10 screenshot. Use a three-zone layout:

- Left: full-height control rail with Home, Conversations, Logs, Settings, runtime state, and totals.
- Center: large "Work Graph" surface where projects are territories, traces are paths, and conversations are nodes. Adapter color rings identify Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp.
- Bottom: "Signal Tape" showing chronological ingest/push/runtime events such as "codex load", "SQLite write", "route matched", "team-postgres pushed", "config reload".
- Right: compact "Insight Drawer" showing cost anomaly, unresolved fork, memory pressure, and export readiness.

Style: a fusion of code graph explorer, audio mixing desk, and flight instrument panel. Use sharp technical typography, dark graphite material, fine luminous graph lines, green/amber/red operational status, and subtle depth. Keep the UI plausible for an Electron app and readable as a product screenshot.

Text rendering requirements: render exact labels "Work Graph", "Signal Tape", "Insight Drawer", "SQLite write", "team-postgres pushed", "config reload", "Claude Code", "Codex", "Cursor", "Gemini CLI", "Home".

Camera/lighting: front-facing 2K desktop UI capture, no perspective angle, precise legible text, polished product mockup, high contrast without neon excess.

