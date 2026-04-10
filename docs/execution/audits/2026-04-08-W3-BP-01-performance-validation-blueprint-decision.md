# W3-BP-01 Performance Validation Blueprint Decision

## Decision

Add a dedicated `BP-10: Performance Validation & Release Gate`, while also
hardening `BP-01`, `BP-02`, and `BP-04` to point at it.

## Why Existing BPs Were Not Enough

`BP-02` and `BP-04` already owned important pieces of the contract:

- `BP-02` owned the runtime budgets and queue semantics
- `BP-04` owned the adapter discover/load memory contract and the
  in-memory-by-default checkpoint model

But the recent failures were not caused by those contracts being absent in the
abstract. They were caused by there being no single blueprint that required
repeatable proof on the layered paths that actually failed:

- discovery-only startup scan
- ingest with representative store shape
- integrated startup `ingestAll -> pushDirty`
- real foreground/runtime shutdown-flush behavior

That gap is visible in the recent evidence:

- `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
  hardened the adapter memory contract, but intentionally left a review/process
  gap to be solved elsewhere
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
  showed that a packet-local ingest harness was not enough to catch the real
  runtime failure
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md` and
  `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`
  both point to the same missing contract: evidence must be layered and
  reviewable, not assumed

## Rejected Alternative

Do not keep this only as scattered BP-01/BP-02/BP-04 prose.

That approach would still leave no single citeable release-gate section for
future packets, and would keep artifact expectations, local-versus-CI rules,
and persisted-state thresholds split across multiple blueprints.

## Chosen Shape

- `BP-01` now distinguishes cheap adapter presence detection from expensive
  startup discovery, so the module map no longer implies that rich-adapter
  startup work is trivially cheap
- `BP-02` now says explicitly that it owns budgets while `BP-10` owns the
  release-validation ladder and artifacts
- `BP-04` now ties rich-adapter changes to representative validation and makes
  persisted adapter state conditional on lightweight metadata plus BP-10 proof
- `BP-10` owns the reusable release gate: stages, artifacts, local-vs-CI split,
  and persisted-state rules

## Persisted-State Decision

`BP-10` is needed in part because persisted adapter state is no longer just an
adapter implementation detail once it is proposed as a perf escape hatch.

Current decision:

- default remains in-memory checkpoint state only
- future persisted state is acceptable only for lightweight checkpoint metadata
- full bundles, message bodies, tool calls, whole-source parses, and sink
  payloads remain out of contract

## Result

Future perf-sensitive packets now have one blueprint section to cite for the
release gate instead of recreating packet-local runbooks from scratch.
