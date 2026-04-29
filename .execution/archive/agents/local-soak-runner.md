# Agent Heartbeat

- agent: `local-soak-runner`
- packet: `W3-PERF-08`
- task: `docs/execution/tasks/W3-PERF-08-long-running-coordinator-soak.md`
- branch: `feat/post-ontology-rewrite-fixes`
- mode: `local detached soak`
- status: `in_progress`
- launch intent: `run an overnight workerized coordinator soak against copied heavy Claude/Codex seeds with periodic churn`
- session: `jin-soak-w3-perf-08`
- outDir: `/tmp/jin-parent-soak-overnight`
- initial status:
  - process alive
  - copied heavy Claude/Codex sources under temp adapter roots
  - sinks disabled
  - parent PID `2770`
