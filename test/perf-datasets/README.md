# Performance Scale Datasets

This packet owns deterministic, on-demand rich-adapter datasets under
`test/perf-datasets/generated/`.

## Scenarios

- `codex-heavy`
  - one Codex trace per scale unit
  - each trace yields `2` source files and `3` refs: root, compacted child,
    and spawned child
- `claude-code-heavy`
  - one Claude Code project per scale unit
  - each project yields `2` source files and `3` refs: root, compacted child,
    and spawned child
- `mixed-rich`
  - one Codex trace plus one Claude Code project per scale unit

## Scale Tiers

- `1x` -> `1` scale unit
- `10x` -> `10` scale units
- `100x` -> `100` scale units

## Commands

Generate one dataset:

```sh
bun scripts/perf-datasets/generate.ts --scenario codex-heavy --scale 10x
```

Generate every scenario and scale:

```sh
bun scripts/perf-datasets/generate.ts --all
```

Validate one generated dataset against its manifest:

```sh
bun scripts/perf-datasets/validate.ts --dataset test/perf-datasets/generated/codex-heavy/10x
```

Validate every generated dataset:

```sh
bun scripts/perf-datasets/validate.ts --all
```

Clean one scenario or one specific scale:

```sh
bun scripts/perf-datasets/clean.ts --scenario mixed-rich
bun scripts/perf-datasets/clean.ts --scenario mixed-rich --scale 100x
```

Clean the full generated tree:

```sh
bun scripts/perf-datasets/clean.ts --all
```

## Manifest Format

Every generated dataset writes `manifest.json` at the dataset root. The manifest
contains:

- `scenario`, `scaleTier`, and `scaleUnits`
- per-adapter `expectedFiles`
- per-adapter `expectedRefs` with relative source path, trace, parent, and
  relationship metadata
- per-adapter `traces` summarizing retained compaction chains and spawned
  children
- overall totals for source files and refs

The manifest is derived from the adapters' own `findChanged()` and
`loadConversation()` output so the committed seeds stay aligned with the
frozen ontology and adapter contracts without hardcoding adapter-specific
continuation IDs in advance.
