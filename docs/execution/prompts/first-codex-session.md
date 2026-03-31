Work in `/Users/edenmendel/Documents/GitHub/jin`.

Start with the execution system already in the repo. Read these in order:

1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/01-dispatch-protocol.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/02-progress-and-audit.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/03-blueprint-task-map.md`
5. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W0-CODEX-01-contract-freeze.md`

Then execute `W0-CODEX-01` fully.

Your job is not to only propose a plan. Make the actual contract-freeze
changes now.

Goal:
Freeze the shared v2 contracts so Wave 1 worker packets can execute without
semantic drift.

Read the BP docs and current code files listed in `W0-CODEX-01`, then publish
the frozen v2 contract surface in code and any supporting docs needed for Wave
1. This includes:

- parsed conversation / message / tool-call shapes
- conversation relationship semantics
- `ConversationRef` / `ConversationBundle`
- adapter contract
- push payload / push result contract
- store bundle-write + revision semantics
- routing/config semantics
- lifecycle ownership + shutdown semantics

Constraints:

- follow `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
- stay within the ownership and forbidden-file rules in `W0-CODEX-01`
- do not do broad adapter, sink, pipeline, or CLI rewrites
- update Wave 1 packets if the frozen contracts change their ownership or stop
  conditions
- if a blueprint is ambiguous or inconsistent, stop and explain the decision
  Codex must make

Expected output:

- actual code and doc changes that freeze the contract surface
- packet updates if needed
- a concise completion report in the exact format from
  `00-global-rules.md`

Work autonomously and continue until `W0-CODEX-01` is actually complete or
blocked by a real cross-boundary decision.
