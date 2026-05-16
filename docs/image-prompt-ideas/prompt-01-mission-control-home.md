# Prompt 01: Mission Control Home

Design a high-fidelity desktop app mockup for "Jin Desktop", a local-first observability workbench for AI coding conversations.

Jin product context: Jin runs as a local daemon on the developer machine. It ingests conversations from AI coding tools including Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future adapters. It normalizes all local tool histories into one canonical SQLite store containing conversations, messages, tool calls, trace IDs, parent/child relationships, spawned sub-agent conversations, forked conversations, compacted conversations, git remotes, branches, cwd/project paths, model usage, input/output/cache tokens, estimated cost, runtime health, discovery cache state, and sink delivery state. Jin Desktop is an Electron UI that reads this data through a typed local daemon API; the renderer does not read files directly.

Subject: the Home tab of Jin Desktop as an operator cockpit for a senior engineer.

Action: show the developer a live, clear overview of what their AI coding work is doing across all tools.

Location/context: a native macOS-style desktop window with a full-height left sidebar. The sidebar contains "Home", "Conversations", "Logs", and "Settings"; Home is selected. Include a compact runtime card showing "RUNNING", local daemon status, total conversations, messages, tool calls, tokens, cost, and traces.

Composition: 16:10 desktop screenshot, straight-on orthographic UI capture, no perspective skew. Main area begins with the exact title text "Home". Below it, create a hero "Mission Control" surface with a large central "Conversation Flow" visualization. The visualization shows recent root conversations branching into spawned and forked traces, with line thickness representing tool-call volume and node size representing token usage. Arrange supporting panels around it:

- "Adapter Mix": Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp.
- "Top Projects": git remotes with conversation counts and token spend.
- "Pipeline Pulse": discovery, ingest, SQLite write, route match, sink push.
- "Sink Health": team-postgres, S3 archive, successful pushes, failed batches, pending backlog.
- "Cost & Tokens": input tokens, output tokens, cache reads/writes, estimated cost.

Style: serious native desktop software, deep ink background, crisp glassy panels, precise spacing, expressive but readable typography similar to Avenir Next or SF Pro Display, restrained blue/green/amber status colors, subtle graph glow, excellent text legibility. Use a calm engineering-control-room mood with polished product quality.

Text rendering requirements: render these exact labels clearly: "Home", "Conversations", "Logs", "Settings", "Conversation Flow", "Adapter Mix", "Pipeline Pulse", "Sink Health", "SQLite Store", "team-postgres", "Claude Code", "Codex", "Cursor", "Gemini CLI".

Lighting/materiality: UI panels feel like layered smoked glass over a dark graphite canvas, with soft edge highlights and minimal bloom. Charts should feel interactive and precise, not decorative.

