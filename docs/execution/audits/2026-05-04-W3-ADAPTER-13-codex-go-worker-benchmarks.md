# W3-ADAPTER-13 Codex Go Worker Benchmarks

Date: `2026-05-04`
Branch: `experiment/go-codex-worker-integration`
Commit at benchmark checkpoint: `6822bd8`

## Scope

This note records two measurement tracks:

1. real local Codex session files run through the actual worker ingest path with TS vs Go, five runs each
2. full `jin` cold-start runs with the current branch binary:
   - TS-only baseline
   - Go workers enabled for `claude-code` and `codex`

## Exact Commands

### Build

```bash
go build -o ../go-parser-bin . \
  # cwd: tools/parser-spike/go-parser

bun run build
```

### Focused parity validation

```bash
bun test \
  test/worker-command.test.ts \
  test/worker-ingest.test.ts \
  test/worker-go-codex-parity.test.ts \
  test/worker-go-parity.test.ts
```

### Real local Codex TS vs Go worker batch

The repo helper added in this branch measures one session file at a time through
`ingestConversationViaWorker` and emits a JSON summary.

```bash
bun run tools/parser-spike/codex-worker-bench.ts ts <source-jsonl>
bun run tools/parser-spike/codex-worker-bench.ts go <source-jsonl>
```

The 5x serial batch was run with `/usr/bin/time` and wrote artifacts under:

- `/tmp/jin-codex-bench-j6C2nn/runs.csv`
- `/tmp/jin-codex-bench-j6C2nn/summary.tsv`
- `/tmp/jin-codex-bench-j6C2nn/hash-parity.tsv`

Representative files:

| Label | Source file | Size |
| --- | --- | ---: |
| `small` | `~/.codex/sessions/2026/05/03/rollout-2026-05-03T22-02-16-019defdd-120b-7b22-94a6-3f125a768fd2.jsonl` | `664,475 B` |
| `large` | `~/.codex/sessions/2026/05/01/rollout-2026-05-01T10-08-06-019de302-8506-7c00-a6ca-33485a634a3c.jsonl` | `5,752,303 B` |
| `xl` | `~/.codex/sessions/2026/05/03/rollout-2026-05-03T03-22-02-019debdb-7ae5-7ad1-90f3-6a7eab05ddf7.jsonl` | `17,277,134 B` |

### Cold-start runs

The existing cold-start harness was reused:

```bash
/tmp/jin-coldboot-LuFtm2/measure_boot.sh \
  /home/edmininode/here-we-code/jin/jin \
  local-ts-only \
  /tmp/jin-codex-bench-j6C2nn \
  /tmp/jin-coldboot-codex-ts
```

```bash
env \
  JIN_EXPERIMENT_CLAUDE_CODE_WORKER=go \
  JIN_EXPERIMENT_CLAUDE_CODE_GO_BINARY=/home/edmininode/here-we-code/jin/tools/parser-spike/go-parser-bin \
  JIN_EXPERIMENT_CODEX_WORKER=go \
  JIN_EXPERIMENT_CODEX_GO_BINARY=/home/edmininode/here-we-code/jin/tools/parser-spike/go-parser-bin \
  /tmp/jin-coldboot-LuFtm2/measure_boot.sh \
  /home/edmininode/here-we-code/jin/jin \
  local-go-workers \
  /tmp/jin-codex-bench-j6C2nn \
  /tmp/jin-coldboot-go-workers
```

The harness records aggregate process-tree RSS and CPU in:

- `local-*-metrics.json`
- `local-*-metrics.csv`
- `local-*-rss-samples.tsv`
- `local-*-status-samples.jsonl`

## Real Local Codex Worker Results

### Timing and RSS Summary

Values below are the mean of five serial runs.

| File | Mode | Mean wall sec | Mean max RSS MB | Mean user sec | Mean sys sec | CPU samples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `small` | TS | `0.332` | `77.3` | `0.296` | `0.074` | `107%;117%;109%;123%;102%` |
| `small` | Go | `0.246` | `78.1` | `0.162` | `0.040` | `99%;82%;104%;54%;109%` |
| `large` | TS | `2.812` | `112.6` | `1.572` | `0.430` | `68%;76%;70%;70%;72%` |
| `large` | Go | `2.300` | `112.8` | `0.946` | `0.252` | `53%;50%;53%;53%;50%` |
| `xl` | TS | `7.466` | `170.9` | `4.060` | `1.208` | `67%;72%;71%;71%;70%` |
| `xl` | Go | `7.472` | `118.5` | `3.880` | `0.772` | `59%;63%;62%;62%;64%` |

### Interpreted deltas

| File | Wall-time delta | RSS delta | Read |
| --- | --- | --- | --- |
| `small` | Go faster by about `1.35x` | effectively tied | modest speed win |
| `large` | Go faster by about `1.22x` | effectively tied | moderate speed win |
| `xl` | wall time tied | Go lower by about `52.9 MB` | clear memory win |

## Hash and Parity Notes

### Confirmed

- focused worker parity tests passed:
  - `test/worker-command.test.ts`
  - `test/worker-ingest.test.ts`
  - `test/worker-go-codex-parity.test.ts`
  - `test/worker-go-parity.test.ts`
- a direct single-file compare on the real local `small` file showed equal
  persisted snapshots and equal bundle hashes
- a direct single-file compare on the real local `large` file showed equal
  persisted snapshots and equal bundle hashes for all `4` refs

### Caveat on batch hash matrix

The 5x batch hash matrix still showed drift on `large` and `xl`.

That does **not** currently prove a stable TS-vs-Go content mismatch across the
real live worker path, because:

- the direct `large` compare came back fully equal for all refs
- the `xl` compare exposed a spawned-session `parentId` disagreement when the
  child file was staged in isolation
- the real parent file exists in the local `CODEX_HOME`, so the `xl` drift may
  be a staging artifact rather than a live cold-start defect

Current position:

- `small`: parity confirmed
- `large`: direct compare confirmed, batch matrix still noisy
- `xl`: not yet cleanly resolved

## Cold-Start Results

### TS-only baseline

This run completed cleanly.

| Label | Boot time | Peak aggregate RSS MB | Final aggregate RSS MB | Peak aggregate CPU | Final aggregate CPU | Sessions | Messages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `local-ts-only` | `438.230 s` | `263.3` | `72.7` | `167.2%` | `6.1%` | `288` | `21,956` |

Source: `/tmp/jin-codex-bench-j6C2nn/local-ts-only-metrics.json`

### Go workers for Claude + Codex

This run was **contaminated** by the active Codex session watcher.

While the measurement was running, new messages in the current chat retriggered
watcher ingestion, so the harness never reached a trustworthy terminal
condition. The run is still useful as an observed sample.

Observed top-line values from the live sample stream:

| Label | State | Value |
| --- | --- | ---: |
| `local-go-workers` | earliest full-shape point | about `174.537 s` at `288 / 21,960` |
| `local-go-workers` | current observed peak aggregate RSS so far | `149.8 MB` |
| `local-go-workers` | recent steady RSS tail | about `79.7` to `81.4 MB` |
| `local-go-workers` | latest observed count in contaminated run | `288 / 21,967` |

Interpretation:

- Go workers reached the full indexed shape much earlier than the TS-only
  baseline
- observed peak RSS in the contaminated run was materially lower than the clean
  TS-only peak
- the exact final boot-complete metric for the Go run still needs a rerun
  against a frozen copy of the watched session tree

## Bottom Line

### What looks real

- Codex Go `loadConversation` is viable through the existing worker seam
- real local Codex files show speed wins on `small` and `large`
- the `xl` real local file shows a strong memory reduction
- combined Go workers for `claude-code` + `codex` likely reduce cold-start peak
  RSS materially

### What is still not fully closed

- repeatable batch hash parity on larger real Codex session shapes
- uncontaminated final cold-start completion numbers for the combined Go-worker
  run

## Artifact Index

- local Codex worker batch:
  - `/tmp/jin-codex-bench-j6C2nn/runs.csv`
  - `/tmp/jin-codex-bench-j6C2nn/summary.tsv`
  - `/tmp/jin-codex-bench-j6C2nn/hash-parity.tsv`
- cold-start baseline:
  - `/tmp/jin-codex-bench-j6C2nn/local-ts-only-metrics.json`
  - `/tmp/jin-codex-bench-j6C2nn/local-ts-only-rss-samples.tsv`
- cold-start Go-worker sample:
  - `/tmp/jin-codex-bench-j6C2nn/local-go-workers-rss-samples.tsv`
  - `/tmp/jin-codex-bench-j6C2nn/local-go-workers-status-samples.jsonl`
