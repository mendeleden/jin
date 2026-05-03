# Cold Boot Deep Telemetry - 2026-05-03

This note captures the clean reruns after the earlier `remote-deep` attempt was invalidated by two concurrent harness processes writing to the same output files.

## Clean runs

Remote published binary:
- label: `remote-deep-clean`
- binary: `/home/edmininode/.local/bin/jin`
- boot: `439466 ms`
- peak aggregate RSS: `255892 KB`
- final aggregate RSS: `72928 KB`
- final state: `283` conversations, `21695` messages

Current branch with Go Claude worker enabled:
- label: `branch-deep-clean`
- binary: `/tmp/jin-coldboot-LuFtm2/jin-branch-deep`
- boot: `538255 ms`
- peak aggregate RSS: `265444 KB`
- final aggregate RSS: `71348 KB`
- final state: `283` conversations, `21704` messages

## Top line

- The clean remote rerun finished faster than the current branch run: `439466 ms` vs `538255 ms`
- The current branch run had a slightly higher peak aggregate RSS: `265444 KB` vs `255892 KB`
- The current branch run had a slightly lower final aggregate RSS: `71348 KB` vs `72928 KB`
- Final conversation counts matched exactly: `283` vs `283`
- Final message counts were close but not identical: `21704` vs `21695`

## What the debug TSVs show

The peak memory difference is not explained by the Go Claude worker alone.

Peak debug-event combined RSS:
- remote: `280 MB`
- branch: `295 MB`

Peak debug-event row on remote:
- adapter: `codex`
- phase: `after-drop`
- parent RSS: `102 MB`
- worker RSS: `178 MB`
- combined RSS: `280 MB`

Peak debug-event row on branch:
- adapter: `codex`
- phase: `stream-300`
- parent RSS: `100 MB`
- worker RSS: `195 MB`
- combined RSS: `295 MB`

Interpretation:
- the branch peak occurred during a Codex worker phase, not a Claude Go worker phase
- parent RSS at the peak was roughly the same on both runs
- the larger branch peak came mostly from a larger worker-side RSS at the peak point
- so the clean deep reruns do not support a simple story that "Go Claude worker raised total peak RSS"

## Generated artifacts

Comparison files:
- [deep-run-comparison.csv](/tmp/jin-coldboot-LuFtm2/deep-run-comparison.csv)
- [deep-run-artifacts.tsv](/tmp/jin-coldboot-LuFtm2/deep-run-artifacts.tsv)

Per-run flat files:
- remote: [remote-deep-clean-metrics.csv](/tmp/jin-coldboot-LuFtm2/remote-deep-clean-metrics.csv), [remote-deep-clean-rss-samples.tsv](/tmp/jin-coldboot-LuFtm2/remote-deep-clean-rss-samples.tsv), [remote-deep-clean-status-samples.tsv](/tmp/jin-coldboot-LuFtm2/remote-deep-clean-status-samples.tsv), [remote-deep-clean-debug-events.tsv](/tmp/jin-coldboot-LuFtm2/remote-deep-clean-debug-events.tsv)
- branch: [branch-deep-clean-metrics.csv](/tmp/jin-coldboot-LuFtm2/branch-deep-clean-metrics.csv), [branch-deep-clean-rss-samples.tsv](/tmp/jin-coldboot-LuFtm2/branch-deep-clean-rss-samples.tsv), [branch-deep-clean-status-samples.tsv](/tmp/jin-coldboot-LuFtm2/branch-deep-clean-status-samples.tsv), [branch-deep-clean-debug-events.tsv](/tmp/jin-coldboot-LuFtm2/branch-deep-clean-debug-events.tsv)
