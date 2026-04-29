---
title: W3-PERF-04 - Fresh-branch diagnostic baseline
date: 2026-04-13
packet: W3-PERF-04
author: codex
---

# W3-PERF-04 - Fresh-branch diagnostic baseline

## Scope

- branch: `feat/post-ontology-rewrite-fixes`
- base: `origin/main`
- contract/store-write experiment: intentionally excluded
- diagnostic tooling: replayed from `origin/debug-and-log`, then extended locally

This run was meant to answer one question: after resetting to `origin/main` and
reapplying only the diagnostic work, what does the real RSS picture look like?

## What Is On This Branch

Included:

- pipeline diagnostic logger
- diagnostic viewer and dev server
- detect-phase events
- per-batch ref/source-path logging
- adapter-boundary reclaim events
- static SVG renderer
- durable notes on hidden contract drift and Bun/JSC vs native heap

Explicitly not included:

- adapter-to-store writes
- BP-04 contract extension
- writer/session experiment

## Fresh 256 MB Control

Harness:

- `bun /tmp/jin-watch-fresh-256-control.ts`

Outcome:

- failed at `RSS 257 MB`
- failing adapter: `claude-code`
- progress: `781/916`

Persisted store at failure:

- conversations: `781`
- messages: `34902`
- tool calls: `12620`

Exact failing source path:

- `~/.claude/projects/-Users-edenmendel-Documents-GitHub-jin/ca95bce7-24cd-48f7-afe8-b5d08a49ab01/subagents/agent-acompact-f4e502b11b8805bb.jsonl`

Observed file sizes near the cliff:

- `agent-acompact-7ac31a81faac1e26.jsonl` — `6.454 MB`
- `agent-acompact-af2bcf08253ea58b.jsonl` — `2.776 MB`
- `agent-acompact-f4e502b11b8805bb.jsonl` — `10.813 MB`

Important trace detail:

- reclaim stayed flat at the batch boundary (`deltaMb = 0`)
- the final five Claude batches climbed `253 -> 255 -> 255 -> 256 -> 257 MB`

## 256 MB With `MIMALLOC_PURGE_DELAY=0`

Harness:

- `MIMALLOC_PURGE_DELAY=0 MIMALLOC_SHOW_STATS=1 bun /tmp/jin-watch-fresh-256-mimalloc.ts`

Outcome:

- also failed at `RSS 257 MB`
- still in `claude-code`
- progress: `776/916`

So on the clean branch, immediate mimalloc purging no longer closes the run by
itself.

## 256 MB With `bun --smol`

Harness:

- `bun --smol /tmp/jin-watch-fresh-256-smol.ts`

Outcome:

- `claude-code` completed `916/916`
- `cursor` completed `100/100`
- failure moved to `codex`
- failing point: `26/294`
- hard limit: `RSS 258 MB`

Persisted counts at failure:

- conversations: `1042`
- messages: `50424`
- tool calls: `20173`

So `--smol` helps, but it does not solve the multi-adapter startup envelope.

## 300 MB Control

Harness:

- `bun /tmp/jin-watch-fresh-300-control.ts`

Outcome:

- `claude-code` completed `916/916`
- `cursor` completed `100/100`
- `codex` reached `269/294`
- hard limit at `RSS 301 MB`

Persisted counts at failure:

- conversations: `1285`
- messages: `72486`
- tool calls: `41773`

Exact failing Codex source path:

- `~/.codex/sessions/2026/04/11/rollout-2026-04-11T08-27-24-019d7c82-de69-7173-bda2-d9c0a92a83d4.jsonl`
- size: `20.428 MB`

Adapter-boundary read:

- after Claude: `239 MB`, reclaim `0 MB`
- after Cursor: `245 MB`, reclaim `0 MB`
- Codex then climbs to `301 MB`

## Heap Split Read

Across the fresh-branch runs, sampled `bun:jsc.heapStats()` stayed small even at
or near peak RSS:

- fresh 256 control peak sample: `RSS 257 MB`, `jscHeapSizeMb = 4`
- fresh 256 smol peak sample: `RSS 258 MB`, `jscHeapSizeMb = 5`
- fresh 300 control peak sample: `RSS 301 MB`, `jscHeapSizeMb = 5`

That keeps the same core conclusion alive:

- this still does not look like a classic "large live JS heap" problem
- it looks more like retained/native/runtime residency, plus borderline
  per-adapter accumulation across the startup pass

## Visual Artifacts

- `docs/tmp-diagram/w3-perf-fresh-branch-256-control.svg`
- `docs/tmp-diagram/w3-perf-fresh-branch-256-smol.svg`
- `docs/tmp-diagram/w3-perf-fresh-branch-300-control.svg`

## Current Read

The fresh branch is cleaner, but it does not make the RSS issue disappear.

What it did give us:

- a branch with no hidden contract extension
- better diagnostics at the exact failing seam
- confirmation that the cliff is still real on a clean baseline
- proof that `--smol` changes the shape but does not close the full run
- concrete source files and adapter boundaries to target next
