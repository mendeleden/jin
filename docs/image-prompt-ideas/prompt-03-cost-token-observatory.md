# Prompt 03: Cost And Token Observatory

Create a high-fidelity desktop UI mockup for the Jin Desktop Home tab focused on AI coding usage economics.

Jin product context: Jin watches local AI coding tools and ingests their conversation histories into one normalized SQLite store. Supported/future adapters include Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and other CLIs or IDE agents. Jin tracks conversations, messages, tool calls, model names, input tokens, output tokens, cache-read tokens, cache-write tokens, thinking tokens, estimated cost, project/git metadata, trace relationships, and sink push state. Users need to understand how AI-assisted development activity translates into cost, model usage, cache efficiency, and project value.

Subject: a cost and token observatory for developers using multiple AI coding agents.

Action: show where token spend is going, which adapters/models are driving cost, and which traces deserve review.

Location/context: native desktop app in a dark macOS-style shell. Left side panel is full-height and contains Home, Conversations, Logs, Settings, runtime state, and aggregate counts. Home is active.

Composition: 16:10 screenshot. At the top, show exact page title "Home". Main hero panel title: "Token & Cost Observatory". Use a stacked daily burn chart across the last 30 days. Stacked bands represent adapters: Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp. Overlay subtle model-family markers for "GPT", "Claude", "Gemini", and "local". Include hover-card-like callouts with exact figures.

Supporting panels:

- "Cache Efficiency": gauge showing cache read/write benefit.
- "Top Expensive Traces": table with trace ID, project, model, tokens, cost.
- "Cost Anomalies": timeline of sudden spikes.
- "Project Spend": git remotes ranked by token cost and conversations.
- "Model Mix": messages and cost by model.
- "Sink Export Coverage": whether team_id and user_id metadata are present for analytics sinks.

Style: premium financial/engineering instrument, not a generic SaaS dashboard. Use dark graphite, muted cyan, steel blue, warm amber, and precise white typography. Charts should be crisp and analytical with dense numeric labels. Make it feel trustworthy enough for debugging spend and presenting to a team.

Typography/text requirements: render exact labels "Token & Cost Observatory", "Cache Efficiency", "Top Expensive Traces", "Cost Anomalies", "Project Spend", "Model Mix", "team_id", "user_id", "team-postgres", "SQLite Store".

Lighting/materiality: subtle glass panels, clean borders, soft inner shadows, restrained glow on selected data points. Use clear alignment and strong visual hierarchy.

