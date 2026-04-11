# W3-SCALE-01 Deterministic Scale Datasets

Completed:
- added deterministic Bun generators for `codex-heavy`, `claude-code-heavy`, and `mixed-rich` scenarios at `1x`, `10x`, and `100x`
- added manifest generation derived from live adapter parse output so compacted chains and spawned children are recorded without hardcoding adapter-specific continuation ids
- added on-demand validate and clean commands plus packet-local README and focused Bun coverage
- generated and validated all nine dataset manifests under `test/perf-datasets/generated/**`

Files changed:
- `.execution/agents/codex-WORKER-scale-datasets.md`
- `docs/execution/audits/2026-04-08-W3-SCALE-01-deterministic-scale-datasets.md`
- `scripts/perf-datasets/clean.ts`
- `scripts/perf-datasets/generate.ts`
- `scripts/perf-datasets/lib.ts`
- `scripts/perf-datasets/validate.ts`
- `scripts/perf-datasets/validate_helpers.ts`
- `test/perf-datasets/.gitignore`
- `test/perf-datasets/README.md`
- `test/perf-datasets/scale-datasets.test.ts`

Tests run:
- `bun test test/perf-datasets/scale-datasets.test.ts`

Validation run:
- exact generation commands
  - `bun scripts/perf-datasets/generate.ts --all`
- manifest paths
  - `test/perf-datasets/generated/claude-code-heavy/1x/manifest.json`
  - `test/perf-datasets/generated/claude-code-heavy/10x/manifest.json`
  - `test/perf-datasets/generated/claude-code-heavy/100x/manifest.json`
  - `test/perf-datasets/generated/codex-heavy/1x/manifest.json`
  - `test/perf-datasets/generated/codex-heavy/10x/manifest.json`
  - `test/perf-datasets/generated/codex-heavy/100x/manifest.json`
  - `test/perf-datasets/generated/mixed-rich/1x/manifest.json`
  - `test/perf-datasets/generated/mixed-rich/10x/manifest.json`
  - `test/perf-datasets/generated/mixed-rich/100x/manifest.json`
- parseability checks
  - `bun scripts/perf-datasets/validate.ts --all`
  - `du -sh test/perf-datasets/generated` -> `4.2M`

BP acceptance matrix:
- generated datasets preserve ontology-relevant structure like compacted chains and spawned children -> implemented in `scripts/perf-datasets/lib.ts` via scenario builders plus manifest `traces` / `expectedRefs`, tested by `bun test test/perf-datasets/scale-datasets.test.ts` and `bun scripts/perf-datasets/validate.ts --all`
- dataset generation is deterministic from committed seeds -> implemented in `scripts/perf-datasets/lib.ts` and `scripts/perf-datasets/generate.ts`, tested by the repeated-generation assertion in `test/perf-datasets/scale-datasets.test.ts`
- scale tiers are consumable by future perf harnesses without live private data -> implemented in `scripts/perf-datasets/generate.ts`, `scripts/perf-datasets/validate.ts`, and `test/perf-datasets/README.md`, tested by `bun scripts/perf-datasets/generate.ts --all`
- the packet does not widen runtime or adapter contracts -> implemented by keeping the diff inside `scripts/perf-datasets/**`, `test/perf-datasets/**`, and this packet-local audit; `src/**` and blueprint files remained untouched per packet boundary

Dataset contract:
- supported adapters
  - `codex`
  - `claude-code`
- supported scales
  - `1x`
  - `10x`
  - `100x`
- known limits
  - the mixed scenario covers Codex plus Claude Code only; it does not yet add a Cursor shared-DB dataset
  - manifests are generated on demand and ignored by git under `test/perf-datasets/generated/`

V1 comparison:
- `no prior v1 surface`

BP alignment:
- `BP-03`: preserved `traceId`, `parentId`, `relationship`, compacted chains, and spawned children in generated traces and emitted manifests
- `BP-04`: kept generation deterministic from committed seeds, used adapter `findChanged()` / `loadConversation()` output to derive manifests, and avoided any contract-surface changes

Persona council:
- telemetry-agent lens: each scenario scales in bounded source units with manifest-backed `files` and `refs` counts, so future perf work can reason about `O(files)` and `O(refs)` without live private directories
- storage-engine lens: the datasets keep compaction/spawn topology while staying on-demand and small in git; the checked-in artifact is generator code, not retained blobs
- release-engineer lens: one command generates every scenario and one command validates every manifest, and the artifacts live at stable repo paths under `test/perf-datasets/generated/**`

Risks / follow-ups:
- add a Cursor shared-database scale dataset later if `W3-PERF-03` needs mixed rich-adapter coverage beyond file-backed Codex and Claude Code

Blocked / needs Codex:
- none
