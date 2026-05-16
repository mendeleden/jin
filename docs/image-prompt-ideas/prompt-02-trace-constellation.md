# Prompt 02: Trace Constellation

Render a high-fidelity desktop app mockup for the "Home" tab of Jin Desktop, centered on trace lineage.

Jin product context: Jin is a local-first system that ingests AI coding conversation histories from Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and other coding agents. It stores all normalized data in a single local SQLite database. The canonical data model includes conversations, messages, tool calls, trace IDs, root conversations, spawned child conversations, forked conversations, compactions, parent IDs, fork points, adapters, model names, git remotes, branches, local paths, token accounting, estimated cost, and sink push state. Jin Desktop is a daemon-backed viewer, not a cloud dashboard.

Subject: a trace-relationship home page for understanding how AI-assisted engineering work branches.

Action: visualize the structure of developer work as a constellation of conversations and sub-agent branches.

Location/context: Electron-style desktop app window, dark native theme, full-height left navigation rail with "Home" selected and "Conversations", "Logs", "Settings" below it. Runtime card at the bottom says "RUNNING" and shows compact totals.

Composition: 16:10 product screenshot, straight-on UI composition. Center the page around a large "Trace Constellation" canvas. Nodes represent conversations; links represent parent/child/fork relationships. Root conversations are larger anchor nodes. Spawned sub-agent conversations form smaller orbiting clusters. Forked conversations appear as split paths. Compacted conversations appear as compressed nodes. Use color rings for adapters: Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp. Use node size for token count and line brightness for recent activity.

Supporting panels:

- "Largest Traces": trace ID, project name, conversation count.
- "Fork Hotspots": branches with the most forked work.
- "Tool-Heavy Branches": traces with many tool calls.
- "Stale Branches": conversations that stopped without a child or sink delivery.
- "Trace Filters": adapter, project, time range, relationship type.

Style: sophisticated code graph explorer, native macOS desktop app, dark graphite and midnight blue palette, green for healthy runtime, amber for warnings, red only for errors. Use fine grid lines, crisp labels, and subtle depth. Make it feel like a professional engineering instrument for causal understanding.

Camera/composition control: front-facing screenshot, sharp 2K UI detail, high readability, no decorative perspective, no marketing hero illustration. Use dense but organized information hierarchy.

Text rendering requirements: render exact labels "Trace Constellation", "root", "spawned", "forked", "compacted", "Claude Code", "Codex", "Cursor", "Gemini CLI", "Largest Traces", "Fork Hotspots", and "SQLite Store".

