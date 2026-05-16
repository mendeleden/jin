# Prompt 07: Team Sink Analytics

Render a high-fidelity Jin Desktop Home tab for teams that export local AI coding analytics to external systems.

Jin product context: Jin ingests local AI coding conversations from Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Warp, and future adapters. It stores the normalized canonical data in one local SQLite database. It can route full-snapshot payloads to sinks such as Postgres and S3. Sink metadata can include team_id and user_id so external analytics systems can run per-user and per-team reporting. The sink schema includes conversations, messages, tool calls, trace relationships, project metadata, tokens, cost, revision/sync state, and schema compatibility metadata. The first tightly coupled customer is "jin-team" pushing to Postgres.

Subject: a Home dashboard for validating analytics export readiness.

Action: show whether local data is ready for team analytics and whether sink delivery is healthy.

Location/context: native desktop app, full-height left sidebar with Home active, local daemon running. The user is onboarding or verifying a team-postgres sink.

Composition: 16:10 straight-on desktop screenshot. Main hero title: "Analytics Export Readiness". Create a route map from "Local SQLite Store" to "team-postgres" and "S3 archive". Lines show route coverage, backlog, successful pushes, failed pushes, and last delivery time. Add a schema card that shows "schema current", "team_id present", "user_id present", "tool-call key current", and "revision sync healthy".

Supporting panels:

- "Team Identity": team_id, user_id, device name, sink route.
- "Postgres Health": schema version, compatibility, last check.
- "Delivery Backlog": pending conversations and retry batches.
- "Per-User Analytics": whether exported rows can support user-level analysis.
- "Recent Pushes": timestamp, sink, conversations, messages, tool calls.

Style: professional operator UI for beta infrastructure, not enterprise cloud clutter. Use dark native desktop surface, precise status chips, clear route diagrams, and trustworthy schema/identity indicators. Make it feel safe for a team lead to verify data export.

Text rendering requirements: render exact labels "Analytics Export Readiness", "Local SQLite Store", "team-postgres", "S3 archive", "team_id", "user_id", "schema current", "Per-User Analytics", "Postgres Health", "Delivery Backlog".

Visual details: use green for current/healthy, amber for pending/backlog, red only for failed batches. Include small path text like "/Users/edenmendel/.config/jin/store.db" and a local socket label "jin.sock" in a readable monospaced style.

