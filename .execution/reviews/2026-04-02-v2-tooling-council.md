# Tooling Council Review: Jin v2 Pipeline & Runtime

- **date**: 2026-04-02
- **type**: tooling-council (5-persona review)
- **scope**: src/pipeline/, src/db/, src/sinks/webhook.ts, src/lifecycle.ts, src/runguard.ts, src/routing.ts, src/commands/service.ts

## Verdicts

| Expert | Verdict | Key Concern |
|---|---|---|
| Ex-Datadog Agent | CONDITIONAL | No RSS ceiling, no adapter timeouts, CPUQuota 10% vs spec 2% |
| Ex-Homebrew Core | APPROVE | Clean CLI surface, good first-run story |
| Ex-Stripe CLI | APPROVE | Webhook sink is production-quality, idempotency model is correct |
| Ex-ClickHouse | CONDITIONAL | Cold-ingest memory spike risk from JSON.stringify on large bundles |
| Ex-Vector | CONDITIONAL | No adapter timeouts, serial sink processing, inotify exhaustion risk |

## Consensus (5 experts)

| Concern | Verdict | Vote | Impact | Confidence |
|---------|---------|------|--------|------------|
| RSS kill switch missing | CONDITIONAL | 5-0 | HIGH | 95% |
| Per-adapter timeout missing | CONDITIONAL | 4-1 | HIGH | 90% |
| sink.enabled filter missing | CONDITIONAL | 5-0 | HIGH | 95% |
| Consecutive error tracking | CONDITIONAL | 3-2 | MEDIUM | 80% |
| Serial sink processing | APPROVE | 3-2 | LOW | 70% |
| Bundle hash memory spike | CONDITIONAL | 3-2 | MEDIUM | 75% |
| Webhook sink quality | APPROVE | 5-0 | LOW | 95% |
| Store/DB quality | APPROVE | 5-0 | LOW | 95% |
| Lifecycle management | APPROVE | 4-1 | LOW | 85% |
| CPUQuota 10% vs spec 2% | CONDITIONAL | 2-3 | LOW | 60% |

## Key Disagreement

Datadog says "ship nothing without RSS kill switch." Homebrew says "ship to
early users, fast follow." Resolution: side with Datadog — 20 lines of code
prevents the worst possible user experience (daemon OOM-killed silently).

## Action Items (for codex-BRAIN)

### Must-do before W1-PIPE-01 approval

1. RSS kill switch — periodic check in loop.ts (~20 lines)
2. sink.enabled filter in pushDirty (~5 lines)
3. Fix CPUQuota=10% to 2% in service.ts (1 line)

### Should-do before v2 launch

4. Per-adapter timeout wrappers in ingest.ts (~40 lines)
5. Consecutive error count + adapter skip (~30 lines)

### Can defer

6. Concurrent sink delivery (only matters at 3+ sinks)
7. Dead-letter tracking for permanently-failing conversations
8. inotify watch limit handling
9. Route evaluation caching in pushDirty
