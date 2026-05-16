# Prompt 06: Human Workbench

Create a polished Jin Desktop Home mockup that feels human-centered while remaining data-backed.

Jin product context: Jin is a local-first desktop and daemon system for understanding AI coding conversations across tools. It ingests histories from Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future adapters into a unified SQLite store. It tracks conversations, messages, tool calls, trace relationships, parent/child/fork/compaction semantics, git remotes, branches, cwd paths, models, tokens, cost, runtime logs, and sink delivery status. The Home page should help a developer answer: What did I work on? Which agents helped? Which conversations spawned meaningful follow-up? Where did time, tokens, and cost go?

Subject: an editorial "Today in Jin" home page for developers reviewing their AI-assisted work.

Action: summarize the day’s work with rich visual evidence and clear drill-in points.

Location/context: native macOS-style desktop app with a full-height left sidebar. Home is selected. The right side is a calm but expressive dashboard for personal engineering review.

Composition: 16:10 UI screenshot. Main title: "Home". Hero panel title: "Today in Jin". Create a timeline ribbon of conversations grouped by project and adapter. Each segment shows conversation count, tool-call intensity, and trace depth. Add a radial adapter mix chart, a trace depth histogram, and a "Recommended Review" panel that highlights one expensive trace, one unresolved fork, and one failed sink push.

Supporting panels:

- "Work Summary": top projects, messages, tool calls, tokens, cost.
- "Agent Contributions": Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp.
- "Conversation Lineage": roots, spawned children, forks, compactions.
- "Next Review": actionable drill-ins into conversations and logs.

Style: refined native desktop, strong editorial typography, dark ink background, warm human-readable summaries, precise analytics widgets. Make it feel like a private engineering journal backed by real data, not gamification. Use subtle animation cues in the design, such as staged cards and timeline handles, while rendering a static mockup.

Text rendering requirements: render exact labels "Today in Jin", "Work Summary", "Agent Contributions", "Conversation Lineage", "Recommended Review", "Claude Code", "Codex", "Cursor", "Gemini CLI", "SQLite Store".

Camera/lighting: straight-on high-resolution product screenshot, crisp text, soft panel shadows, no decorative characters or mascot.

