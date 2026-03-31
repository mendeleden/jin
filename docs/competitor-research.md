# Competitor Research: AI Coding Tool Observability

**Date:** 2026-03-23
**Context:** Jin v2 ontology redesign, Prismatic enterprise POC

---

## 1. How Coding Tools Expose Data

Before evaluating competitors, understand what each coding tool actually
exposes — this determines what any observability tool can capture.

### Claude Code

| Channel | What It Provides | Limitations |
|---------|-----------------|-------------|
| **Local JSONL files** (`~/.claude/projects/`) | Full conversation: messages, tool calls (I/O), thinking blocks, DAG (parentUuid), compaction, sub-agents, sidechains, tokens (4 types), custom titles | Must be read from disk; no push mechanism |
| **OTEL export** (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) | Metrics: `token.usage`, `cost.usage`, `session.count`, `lines_of_code.count`, `commit.count`, `pull_request.count`. Events: `user_prompt`, `tool_result`, `api_request`, `api_error`, `tool_decision` | Emits metrics + log events, **not traces/spans**. No conversation structure, no message DAG, no compaction lineage. Prompt content excluded by default (privacy) |
| **Hooks system** (Stop, PostToolUse, etc.) | Fires shell commands after events; can trigger HTTP calls or read transcript files | Requires configuration in `settings.json`. Real-time but per-response, not batch |
| **API proxy** (`ANTHROPIC_BASE_URL`) | Raw API request/response: tokens, model, latency | No conversation context — just HTTP traffic. No tool calls, no file edits, no reasoning |

### Codex (OpenAI CLI)

| Channel | What It Provides | Limitations |
|---------|-----------------|-------------|
| **Local JSONL files** (`~/.codex/sessions/`) | Messages, function calls (I/O), reasoning blocks, compaction, model tracking, tokens (3 types) | Sub-agent data exists (`agent_message`, `agent_jobs` tables in `state_5.sqlite`) but is structurally different from JSONL |
| **OTEL export** (`[otel]` in `config.toml`) | Traces + logs in interactive mode: API requests, streamed responses, user input, tool-approval decisions, tool invocation results | `codex exec` emits traces/logs but **no metrics**. `codex mcp-server` emits **nothing**. Known gap: [issue #12913](https://github.com/openai/codex/issues/12913) |
| **API proxy** (`config.toml`) | Raw API traffic | Same limitations as Claude Code proxy approach |

### Cursor

| Channel | What It Provides | Limitations |
|---------|-----------------|-------------|
| **Local SQLite — state.vscdb** (IDE Layer 1) | Full conversation: messages, tokens (per-bubble), tool calls (toolFormerData), per-message timestamps, sub-agent IDs, model, thinking blocks | IDE sessions only — CLI sessions don't appear. WAL-locked while IDE runs |
| **Local SQLite — store.db** (CLI Layer 3) | Messages, roles, model, DAG via `parentId` blob tree, reasoning blocks, tool-call/tool-result blobs | No tokens. CLI/ACP sessions only. Protobuf blobs require special handling |
| **Agent transcripts** (`~/.cursor/projects/<project>/agent-transcripts/`) | Sub-agent conversation files (JSONL), tool_use blocks (name+input) | No tool results, no tokens, no timestamps, no thinking. ACP sessions skip this layer entirely |
| **ACP** (Agent Client Protocol) | JSON-RPC 2.0 over stdio. Full programmatic multi-turn sessions. Streaming updates, tool calls, permission handling | Only creates Layer 3 data. No Layer 1/2. Official SDK: `@agentclientprotocol/sdk` |
| **CLI headless** (`cursor agent -p`) | Stream-JSON events with thinking, tool calls (full I/O), session-level token usage | Creates Layer 2+3 only. No Layer 1 |
| **Hooks** (v1.7, Oct 2025) | Similar to Claude Code hooks | Newer, less documented |
| **OTEL export** | **None** | Complete black box for telemetry |
| **Built-in analytics** (Teams tier, $40/user/mo) | Usage dashboard | Proprietary, no export, no API |

### Summary Matrix

| Capability | Claude Code | Codex | Cursor |
|:-----------|:-----------:|:-----:|:------:|
| Local conversation files | Full | Full | Partial (no tokens) |
| Native OTEL | Metrics + events | Traces + logs (partial) | None |
| Hooks system | Yes | No | Yes (newer) |
| API proxy viable | Yes | Yes | Limited |
| Tool call data in files | Full I/O | Full I/O | None |
| Sub-agent data in files | Yes | Yes (uncaptured) | Yes (uncaptured) |
| Token accounting | 4 types | 3 types | None |

---

## 2. Competitor Categories

The observability space for AI coding tools splits into four tiers:

```
Tier 1: Conversation-Level Analyzers     ← jin's tier
         (full session structure, tool calls, reasoning chains)

Tier 2: API-Level Gateways
         (tokens, cost, latency — no conversation semantics)

Tier 3: OTEL-Native LLM Platforms
         (instrument your own apps, not third-party coding tools)

Tier 4: Enterprise APM Extensions
         (add AI monitoring to existing Datadog/New Relic/etc.)
```

---

## 3. Tier 1: Conversation-Level Analyzers

These tools understand conversation structure — messages, tool calls, turns,
sub-agents. They compete directly with jin.

### 3.1 Langfuse

**Website:** [langfuse.com](https://langfuse.com/)
**Status:** Acquired by ClickHouse (March 2026). Open source (MIT).

**Data model:**
- **Traces** — single request/operation. Carries `user_id`, `session_id`, `metadata`, `tags`
- **Observations** — steps within a trace, three types:
  - **Generations** — LLM calls with `model`, `input`, `output`, `usage_details`, `cost_details`
  - **Spans** — non-LLM operations (tool executions, API calls)
  - **Events** — point-in-time occurrences (no duration)
- **Sessions** — optional grouping of traces into multi-turn conversations
- Backend: Postgres (transactional) + ClickHouse (analytical) + Redis + S3

**How it captures coding tool data:**
- **Claude Code:** Hook-based. Stop hook fires after each assistant response. Reads JSONL transcripts from `~/.claude/projects/`, tracks file offset for incremental reads, queues locally in `~/.claude/state/pending_traces.jsonl` for offline resilience. Creates 3-level trace hierarchy: Turn > LLM/Tool > Individual runs
- **Cursor:** Has a [Cursor integration](https://langfuse.com/integrations/other/cursor) capturing agent activity
- **Codex:** SDK-level only (instrument OpenAI API calls, not the Codex product)
- **OTEL:** Accepts OTLP traces at `/api/public/otel`. SDK v3 is a thin layer on OTEL client. Supports `gen_ai.*`, OpenInference, and MLflow attribute namespaces
- **Also:** Python `@observe()` decorator, TypeScript SDK, OpenAI drop-in replacement, LiteLLM proxy callback, 50+ framework integrations (LangChain, LlamaIndex, CrewAI, etc.)

**Tool calls:** Observations with `as_type="tool"`. Via OTEL: `gen_ai.tool.name`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`

**Token tracking:** Direct from LLM responses when available. Inferred via `tiktoken` (OpenAI) or `@anthropic-ai/tokenizer` (Claude) when not

**Cost:** Built-in pricing for OpenAI, Anthropic, Google. Supports tiered pricing (e.g., Claude Sonnet charges more above 200K input tokens). Custom model pricing via UI/API

**Relevance to jin:** Closest architectural competitor. Reads the same JSONL files. Key differences:
- Langfuse requires hook configuration; jin reads files with zero setup
- Langfuse is real-time (per-response hook); jin is batch (file scan)
- Langfuse has ClickHouse for analytics; jin targets SQLite local + Postgres remote
- Langfuse is a general LLM platform; jin is purpose-built for coding tools (10 adapters)

### 3.2 LangSmith

**Website:** [docs.langchain.com/langsmith](https://docs.langchain.com/langsmith)
**Status:** Closed-source. Free tier: 5K traces/month. Plus: $39/user/month.

**Data model:**
- **Run** — fundamental unit (span). Has `run_type`: `"llm"`, `"chain"`, `"tool"`, `"retriever"`, `"embedding"`, `"prompt"`, `"parser"`
- **Trace** — collection of runs sharing `trace_id`. One root run + child hierarchy ("run tree")
- **Project** — collection of traces for an application
- **Thread** — sequence of traces for a multi-turn conversation (linked via `session_id` / `thread_id` / `conversation_id` in metadata)
- **Feedback** — scores bound to individual runs

**How it captures coding tool data:**
- **Claude Code:** Dedicated integration — [langchain-ai/tracing-claude-code](https://github.com/langchain-ai/tracing-claude-code). Bash script Stop hook reads conversation transcripts, creates 3-level run hierarchy (Turn > LLM/Tool > Individual), posts to `/runs/multipart`. Groups turns under shared `thread_id`
- **Cursor:** No tracing. Has an [MCP server](https://github.com/langchain-ai/langsmith-mcp-server) + Prompts MCP in Cursor marketplace — for querying LangSmith data FROM Cursor, not tracing Cursor sessions
- **Codex:** No tracing. `wrap_openai` instruments OpenAI SDK API calls but not the Codex product
- **OTEL:** End-to-end native OTEL (March 2025+). `pip install "langsmith[otel]"`, `LANGSMITH_OTEL_ENABLED=true`. Endpoint: `https://api.smith.langchain.com/otel/v1/traces`. Supports GenAI, OpenInference, and TraceLoop semantic conventions. Can fan out via OTEL Collector to LangSmith + Datadog/Grafana simultaneously

**Bidirectional flow:**
- **langsmith-fetch** CLI (`pip install langsmith-fetch`) — pulls traces/threads from LangSmith directly into terminal. Designed for coding agents: `langsmith-fetch <trace-url> | claude`
- **LangSmith Skills** — curated markdown + scripts that Claude Code loads on demand. Three skills: `trace`, `dataset`, `evaluator`. Increased Claude Code's performance on LangSmith tasks from 17% to 92%
- **MCP server** — Cursor and Claude Code can query prompts, datasets, experiment results during conversations

**Cost:** Auto-multiplies token counts by built-in pricing table. Custom providers: set `ls_provider` + `ls_model_name` in metadata, configure pricing in workspace. Manual: submit `input_cost`, `output_cost`, `total_cost` in `usage_metadata`

**Relevance to jin:** Well-resourced competitor with strong Claude Code integration. Key differences:
- LangSmith is evaluation-first (experiments, datasets, scoring); jin + Prismatic is analytics-first (cost, efficiency, team reports)
- LangSmith's bidirectional flow (fetch + MCP) is ahead of jin's planned MCP server
- LangSmith is closed-source and priced per-user; jin is local-first and self-hosted
- LangSmith has no Cursor/Codex session tracing

### 3.3 Braintrust

**Website:** [braintrust.dev](https://www.braintrust.dev/)
**Status:** Commercial. Evaluation-first platform.

**Data model:** Hierarchical traces (sessions > conversation turns > tool calls as spans). Experiments and datasets are first-class objects.

**How it captures coding tool data:**
- **Claude Code:** Dedicated plugin — [braintrustdata/braintrust-claude-plugin](https://github.com/braintrustdata/braintrust-claude-plugin). Two components:
  - `trace-claude-code` — captures every session as structured traces via hooks. Uses `TRACE_TO_BRAINTRUST`, `CC_PARENT_SPAN_ID` env vars. Python + Shell.
  - `braintrust` MCP server — lets Claude Code query Braintrust data (experiments, logs, datasets) during conversations
- **Cursor:** MCP/Alyx assistant for querying Braintrust. No session tracing
- **Codex:** No integration found
- **OTEL:** Not mentioned. Proprietary trace format

**Relevance to jin:** Direct competitor for Claude Code observability. Evaluation-centric (experiments, side-by-side prompt comparison, CI regression catching) vs jin's analytics-centric approach. Requires active hook instrumentation.

---

## 4. Tier 2: API-Level Gateways

These tools proxy API traffic between coding tools and LLM providers. They
see tokens, cost, and latency but NOT conversation structure, tool calls,
file edits, or reasoning chains.

### 4.1 Portkey

**Website:** [portkey.ai](https://portkey.ai/)
**Status:** Commercial. 10,000+ GitHub stars. SOC 2 / ISO 27001 / HIPAA.

**Coding tool integrations (broadest coverage):**
- **Claude Code:** Set `ANTHROPIC_BASE_URL` to Portkey. Every request logged. [Docs](https://portkey.ai/docs/integrations/libraries/claude-code)
- **Codex:** Modify `~/.codex/config.toml` to route through Portkey. [Docs](https://portkey.ai/docs/integrations/libraries/codex)
- **Cursor:** Supported via MCP client integration

**What it sees:** Token counts, model, latency, cost, request/response payloads, error rates

**What it doesn't see:** Tool calls within conversations, file operations, reasoning chains, compaction, sub-agents, message DAGs — none of the conversation semantics

**Key features:** 1,600+ LLM routing, budget controls, team spending limits, caching, fallback routing, 20-40ms latency overhead

**Relevance to jin:** Different data tier entirely. Portkey answers "how much are we spending on API calls?" Jin answers "what are developers doing with AI tools?" Complementary, not competing. Could even coexist — Portkey for infrastructure governance, jin for conversation intelligence.

### 4.2 Helicone

**Website:** [helicone.ai](https://www.helicone.ai/)
**Status:** Open source. YC W23. Rust-based gateway (mid-2025).

**Coding tool integrations:** No dedicated integrations. Could theoretically proxy Claude Code via `ANTHROPIC_BASE_URL` but no documented workflow

**Relevance to jin:** Not a direct competitor. API-level proxy with no conversation semantics. 100+ model support, smart caching, automatic failover. More of an infrastructure tool than an analytics platform.

---

## 5. Tier 3: OTEL-Native LLM Platforms

These tools are designed for application developers instrumenting their own
AI applications via SDKs. They do not integrate with third-party coding tools
as end products.

### 5.1 Arize Phoenix

**Website:** [arize.com](https://arize.com/) / [GitHub](https://github.com/Arize-ai/phoenix)
**Status:** Open source. 7,800+ GitHub stars.

- Fully **OTEL-native** via [OpenInference](https://github.com/Arize-ai/openinference) specification (extends OTEL semantic conventions for AI)
- Auto-instrumentation for LangChain, LlamaIndex, DSPy, OpenAI, Anthropic, Bedrock
- Python, TypeScript, Java SDKs
- Self-hostable with no feature gates
- LLM-based evaluators, human annotation workflows, experiment tracking

**Relevance to jin:** Not a competitor (different audience). OpenInference semantic conventions are a useful reference for what attributes to extract and store.

### 5.2 OpenLIT

**Website:** [openlit.io](https://openlit.io/) / [GitHub](https://github.com/openlit/openlit)
**Status:** Open source. Fully OTEL-native.

- One-line auto-instrumentation: `openlit.init()` captures 50+ LLM providers, vector DBs, agent frameworks
- Kubernetes Operator for injection without code changes
- GPU monitoring, guardrails, evaluations, prompt management, vault
- Sends to any OTLP-compatible backend (Grafana, Datadog, New Relic)

**Relevance to jin:** Not a competitor. Reference for OTEL-native architecture and semantic conventions.

### 5.3 Traceloop / OpenLLMetry

**Website:** [traceloop.com](https://www.traceloop.com/) / [GitHub](https://github.com/traceloop/openllmetry)
**Status:** Open source. 6,600+ GitHub stars.

- OTEL extensions for LLM observability using standard OTLP protocol
- Auto-instruments OpenAI, Anthropic, Cohere, Pinecone, LangChain, Haystack
- Python, TypeScript, Go, Ruby SDKs
- Also builds the [OpenTelemetry MCP Server](https://github.com/traceloop/opentelemetry-mcp-server) for querying traces from IDEs
- Pipes into Datadog, Honeycomb, Grafana, New Relic

**Relevance to jin:** Not a competitor. The MCP server for querying traces is interesting — similar concept to jin's planned MCP server but for generic OTEL data.

### 5.4 W&B Weave

**Website:** [wandb.ai/weave](https://docs.wandb.ai/weave)
**Status:** Commercial extension of W&B's ML experiment tracking.

- `@weave.op()` decorator-based automatic logging of inputs, outputs, costs, latency
- Auto-traces OpenAI, Anthropic, Google AI Studio, HuggingFace, Bedrock
- Evaluation pipelines with scorers, RAG evaluation with LLM judges
- Not OTEL-native (proprietary tracing)

**Relevance to jin:** Not a competitor. Developer tool for building AI apps, not observing coding tools.

---

## 6. Tier 4: Enterprise APM Extensions

### 6.1 Datadog LLM Observability

- Enterprise APM extension. Auto-instruments OpenAI, LangChain, Bedrock, Anthropic
- [Codex CLI integration via MCP](https://www.datadoghq.com/blog/openai-datadog-ai-devops-agent/)
- [Natively supports OTEL GenAI semantic conventions](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- Consumption-based pricing; requires Datadog subscription

### 6.2 New Relic AI Monitoring

- MCP Server integration for GitHub Copilot, Claude, and Cursor
- 50+ integrations, agentic AI monitoring with service maps

### 6.3 SigNoz

- Open source OTEL-native APM
- Dedicated docs for [Claude Code monitoring](https://signoz.io/docs/claude-code-monitoring/) and [Codex monitoring](https://signoz.io/docs/codex-monitoring/) via native OTEL export
- Self-hostable (ClickHouse backend)

### 6.4 Others

- **AgentOps** — Python SDK for AI agent monitoring. Community project [claudewatch](https://github.com/blackwell-systems/claudewatch) ("AgentOps for Claude Code")
- **HoneyHive** — Recently shipped [OTEL-native SDKs](https://www.honeyhive.ai/post/product-update-opentelemetry-native-sdks)
- **Humanloop** — Acquired by Anthropic and **sunset September 8, 2025**. No longer a competitor
- **Log10, Parea** — LLM logging/experimentation platforms. No coding tool integrations found
- **Langtrace** — Token counts, duration, costs via OTEL-compatible traces

### 6.5 Cursor-Specific Tools

- **Opik Chat History Extension** ([jacquesverre.com](https://jacquesverre.com/blog/cursor-extension), [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=jverre.opik-chat-history)) — VS Code extension that reads Cursor's `state.vscdb` from within the extension host process. Exports chat history. Demonstrates that a Cursor extension can access `cursorDiskKV` data safely while the IDE is running. Relevant as a reference implementation for Layer 1 reading.
- **cursor_api_demo** ([eisbaw/cursor_api_demo](https://github.com/eisbaw/cursor_api_demo)) — Reverse-engineered Python HTTP/2 client for Cursor's backend API (ConnectRPC/gRPC). Reads auth tokens from `state.vscdb`, calls Cursor's cloud AI directly. Does not create IDE-visible sessions but demonstrates the auth/transport layer.
- **cursor-grpc** ([qozx/cursor-grpc](https://github.com/qozx/cursor-grpc), [Jordan-Jarvis/cursor-grpc](https://github.com/Jordan-Jarvis/cursor-grpc)) — Reverse-engineered `.proto` files for Cursor's gRPC services. Documents the `aiserver.v1.ChatService/StreamUnifiedChatWithTools` endpoint and message types.
- **electron-playwright-mcp** ([fracalo/electron-playwright-mcp](https://github.com/fracalo/electron-playwright-mcp)) — MCP server wrapping Playwright for Electron app automation via CDP. 34+ tools. Could drive Cursor IDE if launched with `--remote-debugging-port`.
- **TensorZero Cursor Reverse Engineering** ([tensorzero.com](https://www.tensorzero.com/blog/reverse-engineering-cursors-llm-client/)) — Blog post documenting Cursor's LLM client protocol internals.

---

## 7. OTEL Semantic Conventions for GenAI

The `gen_ai.*` namespace is part of OpenTelemetry Semantic Conventions v1.37.
Status: **Development** (not yet stable). Managed by the Generative AI
Observability SIG (started April 2024).

### 7.1 Defined Attributes

| Attribute | Description | Jin v2 Equivalent |
|-----------|-------------|-------------------|
| `gen_ai.request.model` | Model name | `conversations.model`, `messages.model` |
| `gen_ai.system` | Provider ("openai", "anthropic") | `conversations.adapter_id` |
| `gen_ai.usage.input_tokens` | Input token count | `messages.input_tokens` |
| `gen_ai.usage.output_tokens` | Output token count | `messages.output_tokens` |
| `gen_ai.usage.cache_read.input_tokens` | Cache read tokens | `messages.cache_read` |
| `gen_ai.usage.cache_creation.input_tokens` | Cache write tokens | `messages.cache_write` |
| `gen_ai.usage.cost` | Cost in USD | `messages.est_cost` |
| `gen_ai.tool.name` | Tool name | `tool_calls.name` |
| `gen_ai.tool.call.id` | Tool call ID | `tool_calls.id` |
| `gen_ai.tool.call.arguments` | Tool input | `tool_calls.input` |
| `gen_ai.tool.call.result` | Tool output | `tool_calls.output` |
| `gen_ai.conversation.id` | Conversation ID | `conversations.id` |
| `gen_ai.agent.id` / `.name` | Agent identity | `conversations` with `relationship='spawned'` |
| `gen_ai.request.temperature` | Sampling temperature | Not captured (not in source data) |
| `gen_ai.tool.definitions` | Tool definitions array | Not captured |

### 7.2 Signal Types

The conventions cover three OTEL signal types:

- **Spans** — client-side spans for individual LLM calls. One span per API request
- **Events** — structured log events for prompts, completions, tool calls (attached to spans)
- **Metrics** — counters/histograms for token usage, duration, operation counts

### 7.3 Agentic Systems Extension

A newer extension ([gen-ai-agent-spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/),
[GitHub #2664](https://github.com/open-telemetry/semantic-conventions/issues/2664))
adds attributes for multi-step agent workflows:

- Tasks, actions, agents, teams
- Artifacts and memory
- Parent-child agent relationships

This aligns with jin's `trace_id` / `parent_id` / `relationship` model for
linking conversations across compaction, forking, and sub-agent spawning.

### 7.4 What Claude Code's OTEL Actually Exports

```
Metrics:
  claude_code.session.count
  claude_code.token.usage        (type: input/output/cacheRead/cacheCreation)
  claude_code.cost.usage         (USD)
  claude_code.lines_of_code.count
  claude_code.commit.count
  claude_code.pull_request.count
  claude_code.active_time.total
  claude_code.code_edit_tool.decision

Events (via OTEL logs protocol):
  claude_code.user_prompt        (prompt.id, length — content excluded by default)
  claude_code.tool_result        (tool_name, success, duration_ms, tool_parameters)
  claude_code.api_request        (model, cost_usd, tokens, duration_ms)
  claude_code.api_error
  claude_code.tool_decision

Common attributes:
  session.id, user.account_uuid, user.email, organization.id, terminal.type
```

**Critical gap:** These are **metrics and log events**, not **traces/spans**.
You cannot send them to a trace backend (Jaeger, Grafana Tempo, Langfuse's
trace view) and get a waterfall. They go to metrics backends (Prometheus,
VictoriaMetrics) and log backends (Loki, ClickHouse).

---

## 8. Competitive Positioning

### What Jin Does That Nobody Else Does

1. **Zero-config, post-hoc file analysis.** No hooks to configure, no env
   vars to set, no SDK to install. Jin reads existing files on disk. Every
   competitor requires setup: Langfuse/LangSmith/Braintrust need hooks,
   Portkey needs proxy config, OTEL tools need SDK instrumentation.

2. **10-adapter cross-tool coverage.** No other tool provides unified
   observability across Claude Code, Codex, Cursor, Gemini CLI, Amp, Kiro,
   OpenCode, Pi, PiAgent, and Warp in a single data model. Portkey covers
   3 (at API level only). LangSmith/Langfuse cover 1-2 (at conversation level).

3. **Cursor conversation data.** Cursor has no OTEL, no telemetry API.
   The only way to get conversation structure from Cursor is file analysis.
   Jin has a working adapter. Langfuse is starting. Nobody else does.

4. **Local-first with remote push.** Data lives in SQLite on the developer's
   machine first, then pushes to Postgres/S3/webhooks. Competitors are
   cloud-first (send data to their servers). Jin works offline, air-gapped,
   on-prem.

5. **Enterprise analytics layer (Prismatic).** No competitor has the
   hierarchical summarization pipeline: conversations → session summaries →
   daily digests → period reports → team reports. LangSmith has evaluation;
   Langfuse has scoring; neither has multi-layer intelligence.

### Where Competitors Are Ahead

1. **Bidirectional flow.** LangSmith (langsmith-fetch, MCP server, Skills)
   and Braintrust (MCP server) let developers query past sessions from within
   their coding tools. Jin's MCP server is planned but not built.

2. **Real-time tracing.** Langfuse/LangSmith/Braintrust capture data
   per-response via hooks. Jin's file-scan approach has inherent latency
   (polling interval). For live debugging, hooks win.

3. **OTEL ecosystem integration.** Langfuse accepts OTLP traces natively.
   LangSmith emits and receives OTEL spans. Jin has no OTEL story yet.
   Teams that already have Grafana/Datadog may prefer tools that plug into
   their existing observability stack.

4. **Evaluation and experimentation.** LangSmith and Braintrust have
   evaluation frameworks (datasets, experiments, scoring, side-by-side
   comparison). Jin + Prismatic does analytics and reporting, not evaluation.

### Competitive Matrix

| Capability | Jin | Langfuse | LangSmith | Braintrust | Portkey |
|:-----------|:---:|:--------:|:---------:|:----------:|:-------:|
| Zero-config setup | **Yes** | No (hooks) | No (hooks) | No (hooks) | No (proxy) |
| Claude Code conversations | **Full** | Full | Full | Full | API only |
| Cursor conversations | **Full** | Starting | No | No | API only |
| Codex conversations | **Full** | SDK only | No | No | API only |
| Other tools (7+) | **Yes** | No | No | No | No |
| Local-first / offline | **Yes** | No | No | No | No |
| Tool calls as SQL | **v2** | Observations | Runs | Spans | No |
| Sub-agent lineage | **v2** | Trace hierarchy | Run tree | Trace hierarchy | No |
| Cost tracking | **Yes** | Yes | Yes | Yes | Yes |
| Token estimation (Cursor) | **Prismatic** | No | No | No | No |
| Enterprise analytics | **Prismatic** | No | Evaluation | Evaluation | Budget alerts |
| Team reports / digests | **Prismatic** | No | No | No | No |
| Bidirectional (MCP) | Planned | No | **Yes** | **Yes** | No |
| OTEL integration | No | **Yes** | **Yes** | No | No |
| Real-time tracing | No (batch) | **Yes** | **Yes** | **Yes** | **Yes** |
| Self-hostable | **Yes** | Yes | No | No | No |
| Open source | **Yes** | Yes (MIT) | No | No | No |

---

## 9. Strategic Implications for Jin

### Cursor Is the Moat

The enterprise POC customer uses Cursor primarily. Cursor provides zero
token data and no telemetry export. Jin's Cursor adapter — reading `store.db`
and (soon) `agent-transcripts/` — is the only way to get conversation-level
data from Cursor sessions. This is jin's strongest competitive position.

Prismatic's token estimation pipeline (P0.1) turns Cursor's zero-token
problem into estimated cost data — something no competitor offers.

### OTEL Is Complementary, Not Competing

Claude Code's OTEL export gives you counters and events. Jin gives you full
conversation structure, message DAGs, compaction lineage, and tool call I/O.
These are different data at different granularities. Jin could:

1. **Ignore OTEL** — continue with file analysis, which captures strictly
   more data than OTEL metrics/events
2. **Consume OTEL** — ingest Claude Code's OTEL events as a secondary signal
   (e.g., `api_request` events give you per-API-call latency that JSONL files
   don't have)
3. **Emit OTEL** — export jin's conversation data as OTEL traces/spans so
   teams with existing Grafana/Datadog stacks can visualize conversations
   in their existing tools

Option 3 is the most interesting strategically — it makes jin a bridge
between coding tools (which emit incomplete OTEL) and enterprise
observability platforms (which expect OTEL traces).

### The `tool_calls` Table Is Validated

Every Tier 1 competitor extracts tool calls into structured objects:
- Langfuse: Observations with `as_type="tool"`
- LangSmith: Runs with `run_type: "tool"`
- Braintrust: Spans for tool invocations

Jin v2's decision to make `tool_calls` a proper SQL table (not a JSON blob)
is the same conclusion everyone reached independently. Prismatic's `assess.ts`
JSON parsing is the exact problem Langfuse/LangSmith solved with structured
tool data.

### Bidirectional Flow Is Table Stakes

LangSmith's `langsmith-fetch` + MCP server and Braintrust's MCP server
show that developers expect to query their observability data from within
their coding tools. Jin's planned MCP server (ontology.md Section 12.4)
should be prioritized — it's the difference between "a tool IT uses" and
"a tool developers use."

---

## Sources

### OTEL & Semantic Conventions
- [OTEL Semantic Conventions for GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [GenAI Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [GenAI Events](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/)
- [GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
- [GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [Agentic Systems Proposal (GitHub #2664)](https://github.com/open-telemetry/semantic-conventions/issues/2664)
- [Datadog OTEL GenAI Support](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [OTEL GenAI Standardization Blog](https://earezki.com/ai-news/2026-03-21-opentelemetry-just-standardized-llm-tracing-heres-what-it-actually-looks-like-in-code/)
- [OTEL Blog: GenAI Observability](https://opentelemetry.io/blog/2024/otel-generative-ai/)

### Claude Code Telemetry
- [Claude Code Monitoring Docs (Anthropic)](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage)
- [Claude Code Monitoring Docs (code.claude.com)](https://code.claude.com/docs/en/monitoring-usage)
- [Telemetry Env Var Confusion (GitHub #19117)](https://github.com/anthropics/claude-code/issues/19117)
- [claude_telemetry Wrapper](https://github.com/TechNickAI/claude_telemetry)
- [claude-code-otel Dashboard](https://github.com/ColeMurray/claude-code-otel)
- [SigNoz: Claude Code OTEL Guide](https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/)
- [SigNoz: Claude Code Monitoring Docs](https://signoz.io/docs/claude-code-monitoring/)
- [VictoriaMetrics: Vibe Coding Observability](https://victoriametrics.com/blog/vibe-coding-observability/)
- [DIY Claude Code Observability](https://doneyli.substack.com/p/i-built-my-own-observability-for)
- [Claude Code Hooks Reference](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)

### Codex Telemetry
- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced)
- [Codex OTEL Events PR #2103](https://github.com/openai/codex/pull/2103)
- [Codex OTEL Gaps (GitHub #12913)](https://github.com/openai/codex/issues/12913)
- [SigNoz: Codex Monitoring Docs](https://signoz.io/docs/codex-monitoring/)
- [opentelemetry-instrumentation-openai-v2 (PyPI)](https://pypi.org/project/opentelemetry-instrumentation-openai-v2/)
- [opentelemetry-instrumentation-openai-agents-v2](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/main/instrumentation-genai/opentelemetry-instrumentation-openai-agents-v2/README.rst)

### Langfuse
- [Langfuse Claude Code Integration](https://langfuse.com/integrations/other/claude-code)
- [Langfuse Cursor Integration](https://langfuse.com/integrations/other/cursor)
- [Langfuse OTEL Integration](https://langfuse.com/integrations/native/opentelemetry)
- [Langfuse Claude Agent SDK](https://langfuse.com/integrations/frameworks/claude-agent-sdk)
- [Langfuse GitHub](https://github.com/langfuse/langfuse)

### LangSmith / LangChain
- [LangSmith Observability Concepts](https://docs.langchain.com/langsmith/observability-concepts)
- [LangSmith OTEL Tracing](https://docs.langchain.com/langsmith/trace-with-opentelemetry)
- [LangSmith Claude Code Tracing](https://docs.langchain.com/langsmith/trace-claude-code)
- [LangSmith Observability Quickstart](https://docs.langchain.com/langsmith/observability-quickstart)
- [LangSmith Cost Tracking](https://docs.langchain.com/langsmith/cost-tracking)
- [LangSmith RunType Reference](https://docs.smith.langchain.com/reference/js/types/schemas.RunType)
- [LangSmith RunTree Reference](https://docs.smith.langchain.com/reference/python/run_trees/langsmith.run_trees.RunTree)
- [LangSmith End-to-End OTEL Blog](https://blog.langchain.com/end-to-end-opentelemetry-langsmith/)
- [LangSmith CLI & Skills Blog](https://blog.langchain.com/langsmith-cli-skills/)
- [LangSmith Fetch Blog](https://blog.langchain.com/introducing-langsmith-fetch/)
- [tracing-claude-code (GitHub)](https://github.com/langchain-ai/tracing-claude-code)
- [langsmith-mcp-server (GitHub)](https://github.com/langchain-ai/langsmith-mcp-server)
- [Claude Code Templates: LangSmith Integration](https://deepwiki.com/davila7/claude-code-templates/8.5-langsmith-tracing-integration)
- [LangChain vs LangGraph vs LangSmith](https://galileo.ai/blog/langchain-vs-langgraph-vs-langsmith)
- [LangSmith Agent Observability (Medium)](https://ravjot03.medium.com/langsmith-for-agent-observability-tracing-langgraph-tool-calling-end-to-end-2a97d0024dfb)

### Braintrust
- [Braintrust](https://www.braintrust.dev/)
- [Braintrust Claude Code Integration Blog](https://www.braintrust.dev/blog/claude-code-braintrust-integration)
- [Braintrust Claude Plugin (GitHub)](https://github.com/braintrustdata/braintrust-claude-plugin)

### Portkey
- [Portkey](https://portkey.ai/)
- [Portkey Claude Code Docs](https://portkey.ai/docs/integrations/libraries/claude-code)
- [Portkey Codex Docs](https://portkey.ai/docs/integrations/libraries/codex)
- [Portkey Claude Code Blog](https://portkey.ai/blog/control-and-visibility-to-claude-code/)

### Helicone
- [Helicone](https://www.helicone.ai/)
- [Helicone Gateway Guide](https://www.helicone.ai/blog/how-to-gateway)

### Arize Phoenix
- [Arize Phoenix Docs](https://arize.com/docs/phoenix)
- [Phoenix GitHub](https://github.com/Arize-ai/phoenix)
- [OpenInference GitHub](https://github.com/Arize-ai/openinference)

### W&B Weave
- [W&B Weave Docs](https://docs.wandb.ai/weave)
- [Weave GitHub](https://github.com/wandb/weave)

### OpenLIT
- [OpenLIT](https://openlit.io/)
- [OpenLIT GitHub](https://github.com/openlit/openlit)
- [OpenLIT Docs](https://docs.openlit.io/)

### Traceloop / OpenLLMetry
- [Traceloop Docs](https://www.traceloop.com/docs/openllmetry/introduction)
- [OpenLLMetry GitHub](https://github.com/traceloop/openllmetry)
- [OpenTelemetry MCP Server (GitHub)](https://github.com/traceloop/opentelemetry-mcp-server)
- [opentelemetry-instrumentation-anthropic (PyPI)](https://pypi.org/project/opentelemetry-instrumentation-anthropic/)
- [@traceloop/instrumentation-anthropic (npm)](https://www.npmjs.com/package/@traceloop/instrumentation-anthropic)

### Other
- [Datadog Codex Integration](https://www.datadoghq.com/blog/openai-datadog-ai-devops-agent/)
- [Cursor Analytics Docs](https://cursor.com/docs/account/teams/analytics)
- [ClaudeWatch (GitHub)](https://github.com/blackwell-systems/claudewatch)
- [AgentOps (GitHub)](https://github.com/AgentOps-AI/agentops)
- [Humanloop Alternatives (sunset)](https://www.keywordsai.co/blog/humanloop-alternatives)
- [HoneyHive OTEL-Native SDKs](https://www.honeyhive.ai/post/product-update-opentelemetry-native-sdks)
- [Best LLM Observability Tools 2026](https://www.firecrawl.dev/blog/best-llm-observability-tools)
