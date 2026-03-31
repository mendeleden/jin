# Adapter Data Deep Dives

**Scope:** Per-tool investigations of how AI coding tools store conversation
data on disk. These docs inform adapter implementation and drive coverage
improvements.

**Related docs:**
- [ontology.md Section 4](../ontology.md) — Adapter Capability Matrix
- [ontology.md Section 6](../ontology.md) — Adapter Mapping Tables
- [architecture/adapters-ingest.md](../architecture/adapters-ingest.md) — Registry and ingest pipeline

---

## Adapter Index

| Adapter | Status | Storage Layers | Current Coverage | Key Gap |
|---------|--------|---------------|-----------------|---------|
| [Cursor](./cursor/) | **Investigated** | 4 | 1 of 4 (CLI store.db only) | IDE state.vscdb, agent-transcripts, ai-tracking |
| Claude Code | Planned | 1 | Full | Sub-agent tree depth, v2 ontology migration |
| [Codex](./codex/) | **Investigated** | 7 | 1 of 7 (JSONL rollouts only) | `token_count` events, `turn_context`, `state_5.sqlite` git/model metadata, encrypted reasoning |
| Gemini CLI | Planned | 1 | Basic | Sub-agent detection (`kind === "subagent"`) |
| Warp | Planned | 1 | Basic | Cross-platform path coverage |
| Kiro | Planned | 1 | Basic | Dynamic schema discovery validation |
| Amp / OpenCode / Pi / PiAgent | Planned | 1 each | Basic | Straightforward JSONL, low priority |

## How to Read These Docs

Each adapter directory contains four files:

| File | Purpose | Primary audience |
|------|---------|-----------------|
| `index.md` | Quick reference card — storage layers, coverage gaps, links | Agents and humans orienting quickly |
| `overview.md` | Storage architecture, data models, jin field mappings | Adapter implementers |
| `investigation.md` | Reproducible forensics log with commands | Peer reviewers, future investigators |
| `examples.md` | Raw data samples, queries, normalized output | Adapter implementers writing parsers |
| `orchestration.md` | Programmatic interfaces, traceability experiments | Adapter testers, automation builders |

Storage layers are numbered consistently across all files for a given adapter
(e.g., Cursor Layer 1 is always `state.vscdb`, Codex Layer 1 is always `state_5.sqlite`).

## Investigation Methodology

| Document | Purpose |
|----------|---------|
| [ADAPTER_INVESTIGATION_PLAYBOOK.md](./ADAPTER_INVESTIGATION_PLAYBOOK.md) | Full methodology — phases, anti-patterns, completion gates |
| [INVESTIGATION_CHECKLIST.md](./INVESTIGATION_CHECKLIST.md) | Quick-reference gate checklist (run before declaring complete) |
