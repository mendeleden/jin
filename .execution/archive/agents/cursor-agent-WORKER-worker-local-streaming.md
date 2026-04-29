# Agent Heartbeat

- agent: `cursor-agent-WORKER-worker-local-streaming`
- packet: `W3-PERF-07`
- task: `docs/execution/tasks/W3-PERF-07-worker-local-streaming-and-source-unit-splitting.md`
- prompt: `docs/execution/prompts/W3-PERF-07-worker-agent.md`
- mode: `current directory / no worktree / yolo`
- branch: `feat/post-ontology-rewrite-fixes`
- status: `completed`
- launch intent: `run Cursor agent headless in the current repo root; review stays on codex exec`
- outcome:
  - selective segment/conversation retention implemented in `codex.ts` and `claude-code.ts`
  - worker drops `bundle.messages` after streaming in `ingest-worker.ts`
  - focused adapter/streaming tests passed
  - live RSS review still required on codex exec with the new amortization probe
