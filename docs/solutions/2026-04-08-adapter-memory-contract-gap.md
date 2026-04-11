---
title: Adapter discover/load needs an explicit memory contract
date: 2026-04-08
tags: [adapter, pipeline, daemon, blueprint]
related: [W3-PERF-01, W3-RECOVERY-01, W3-ADAPTER-05, BP-02, BP-04]
---

# Adapter discover/load needs an explicit memory contract

## Problem

The Codex RSS failure was not just an adapter bug. It exposed a gap between the
blueprint intent and the implementation guardrails.

`BP-04` already says `findChanged()` should be cheap and `loadConversation()`
should be expensive, but that rule is descriptive rather than enforceable. In
practice, an adapter could still:

- fully parse source files during `findChanged()`
- reparse the same file during `loadConversation()`
- retain large successful results behind timeout helpers
- fan out many refs from one source file without a reclamation point

`BP-02` had the RSS limit and batch-yield behavior, but not enough adapter-side
constraints to keep rich file-backed adapters inside that budget.

## Solution

Treat adapter memory behavior as part of the frozen runtime contract, not an
implementation detail.

The follow-on packet should:

- audit every adapter's `findChanged()` and `loadConversation()` path for
  duplicate parsing, ref fan-out, and retention hazards
- harden `BP-02` and `BP-04` so "cheap discover, bounded load" becomes an
  explicit contract with reviewable acceptance checks
- add a reusable adapter audit/checklist so new adapters must answer the same
  memory-profile questions before they are considered production-ready

## Key Insight

The BP-02 RSS hard limit is only a safety brake. It does not by itself create a
bounded ingest design.

For rich adapters, the real contract has to include:

- what `findChanged()` is allowed to do
- how much source material `loadConversation()` may retain at once
- whether timeout helpers can pin successful results
- where reclamation points must exist when one file yields many refs

## Prevention

- update `BP-02` and `BP-04` with explicit adapter memory-contract language
- require representative memory validation for rich/file-backed adapters, not
  just fixture-scale tests
- add an execution packet/checklist for cross-adapter memory audits whenever a
  new rich adapter lands or a runtime RSS bug appears

## Related

- `W3-PERF-01` fixed the concrete Codex RSS overflow
- `W3-RECOVERY-01` handled the poisoned-store recovery story exposed by the same
  crash path
- `W3-ADAPTER-05` should close the broader contract gap across all adapters

## Files Changed

- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
