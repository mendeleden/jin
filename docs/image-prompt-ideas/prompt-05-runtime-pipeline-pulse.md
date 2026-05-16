# Prompt 05: Runtime And Pipeline Pulse

Design a high-fidelity Jin Desktop Home tab as an operational pipeline monitor.

Jin product context: Jin runs a local daemon that monitors AI coding tools, discovers changed sources, loads conversations, writes normalized records into a local SQLite store, computes route matches, and pushes full-snapshot payloads to configured sinks such as Postgres and S3. It supports adapters including Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future agent tools. The data model includes conversations, messages, tool calls, traces, root/spawned/forked/compacted relationships, projects, tokens, costs, sync revisions, sink delivery status, team_id/user_id export metadata, and local runtime health.

Subject: the Home tab for debugging and operating the Jin daemon.

Action: make the live ingestion and push pipeline visible at a glance.

Location/context: dark native desktop app, full-height sidebar with Home active. The user is a senior engineer checking whether local ingest, config reloads, and sink pushes are healthy.

Composition: 16:10 straight-on screenshot. Main hero title: "Pipeline Pulse". Render a horizontal pipeline timeline with stages "Discover", "Load", "SQLite Write", "Route Match", "Push Batch", "Ack". Each stage has throughput, latency, queue depth, and last event. Show moving/event-like bars without making the screenshot blurry. Add a side panel titled "Runtime Health" with daemon PID, socket path, store path, log path, RSS memory, and uptime.

Supporting panels:

- "Adapter Freshness": Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp with scan status.
- "Push Backlog": pending conversations per sink.
- "Recent Events": config reload, route add, sink repush, schema check.
- "Memory Guardrails": warning and hard limit indicators.
- "Failure Lane": most recent push or ingest errors with retry state.

Style: terminal-adjacent but polished, like a professional observability console for a local developer tool. Use dark graphite, blue signal lines, green success, amber backpressure, red critical errors. Use tight monospaced numerics for paths, PIDs, queue depths, and timestamps. Keep visual hierarchy clear and usable.

Text rendering requirements: render exact labels "Pipeline Pulse", "Discover", "Load", "SQLite Write", "Route Match", "Push Batch", "Ack", "Adapter Freshness", "Push Backlog", "Memory Guardrails", "sink repush", "config reload".

Lighting/composition: crisp product screenshot, subtle glow on active pipeline stages, no marketing background, no human figures.

