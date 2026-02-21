# jin — Backlog

Prioritized list of planned work. Items at the top are next up.

---

## In Progress

- [ ] **Local container hosting** — Dockerfile + docker-compose for self-hosted jin with Postgres sink, ready to deploy on any machine

---

## High Priority

- [ ] **Web dashboard (`jin ui`)** — Local web UI showing sessions, messages, cost breakdown, timeline view
- [ ] **Incremental ingest** — Track last-read offset per file to avoid re-parsing entire JSONL/SQLite on every change
- [ ] **Adapter: GitHub Copilot Chat** — Read from VS Code Copilot Chat history
- [ ] **Adapter: Windsurf (Codeium)** — Read from Windsurf/Codeium conversation logs
- [ ] **Adapter: Aider** — Read from `.aider.chat.history.md` and `.aider.input.history`
- [ ] **Adapter: Continue.dev** — Read from Continue conversation history
- [ ] **Sink: ClickHouse** — For teams wanting analytics-optimized storage
- [ ] **Push deduplication** — Track per-message push state, only send deltas to sinks
- [ ] **Session tagging** — Auto-tag sessions by project directory, git branch, language
- [ ] **Export: CSV** — For spreadsheet analysis of token usage and costs

## Medium Priority

- [ ] **Log rotation** — Rotate jin.log when it exceeds a configurable size
- [ ] **Health endpoint** — Optional HTTP health check endpoint when running as daemon
- [ ] **Config validation** — Validate config.json schema on load, helpful error messages
- [ ] **Adapter auto-detection improvements** — Handle non-standard install paths, XDG dirs, Flatpak/Snap
- [ ] **Sink: SQLite (remote)** — Push to a shared SQLite file (Turso/libSQL)
- [ ] **Sink: Elasticsearch/OpenSearch** — For teams with existing ELK stacks
- [ ] **Multi-user merge** — Deduplicate sessions when multiple devs push the same pair-programming session
- [ ] **Pricing updates** — Keep model pricing current as providers change rates
- [ ] **ARM binary releases** — Pre-built binaries for linux-arm64 and darwin-arm64
- [ ] **Homebrew formula** — `brew install jin`
- [ ] **Windows PowerShell installer** — `irm https://... | iex` pattern

## Low Priority

- [ ] **Plugin system** — Let users write custom adapters/sinks as external scripts
- [ ] **Session summarization** — Use an LLM to generate session summaries on ingest
- [ ] **Git integration** — Link sessions to commits/PRs by correlating timestamps
- [ ] **Notification hooks** — Slack/Discord alerts when sessions match patterns (e.g., high cost)
- [ ] **Retention policies** — Auto-prune old sessions from local store after N days
- [ ] **Encryption at rest** — Encrypt local SQLite store and raw file copies
- [ ] **RBAC for team sinks** — Role-based access so team leads can see all, devs see their own
- [ ] **Metrics/Prometheus endpoint** — Expose session counts, push rates, error rates
- [ ] **Offline queue** — Buffer pushes when sinks are unreachable, retry with backoff
- [ ] **Test suite** — Unit tests for adapters (mock JSONL/SQLite), integration tests for sinks

---

## Completed

- [x] Core adapter framework with 10 adapters
- [x] Local SQLite store with normalized schema
- [x] 3 output sinks (Postgres, S3, Webhook)
- [x] Team config encoding/decoding (base64 onboarding codes)
- [x] Background daemon with PID management
- [x] OS service integration (systemd, launchd, Task Scheduler)
- [x] Run guards preventing conflicting instances
- [x] Token/cost analysis across tools and models
- [x] Docker Compose test harness
- [x] curl|sh installer
- [x] All CLI commands (init, watch, status, stop, service, list, show, analyze, ingest, push, export, team-config)
