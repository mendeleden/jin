# Design Decisions

v2 choices — decided or pending. Referenced by the roadmap.

---

## Decided

### DEC-1: RouteMatch drops `project`, adds `adapter` + `name` (Q3, Q15)

```typescript
interface RouteMatch {
  remote?: string;     // glob against conversation.git_remote
  directory?: string;  // glob against conversation.cwd
  adapter?: string;    // exact match against conversation.adapter_id
  name?: string;       // glob against basename(conversation.cwd)
  // Multiple fields = AND (all specified must match)
}
```

`project` removed (no projects table). `adapter` added for non-git
routing. `name` replaces project-name ergonomics.

---

### DEC-2: v2 config → routing mental model (Q14)

Conversation carries routing data as columns (`git_remote`, `cwd`).
Route matching is a direct column read, not a database join.
`teamId`/`developerId` are push-time sink metadata, not conversation
properties.

---

### DEC-3: Tags dropped, replaced by columns (Q15)

All tag infrastructure removed. Replacements:

| v1 Tag | v2 Column |
|--------|-----------|
| tool | `adapter_id` |
| model | `model` |
| project | `git_remote` |
| branch | `branch` (new) |
| status | `relationship`, `est_cost` |
| custom | `labels` JSON array (new) |
| language | Queryable from `tool_calls`, no column |

---

### DEC-4: Keep one generic S3 sink (Q20)

Don't split into per-provider classes. Add `pathStyle` config flag
(auto-detect: custom endpoint → path-style, AWS → virtual-hosted).
Auto-detect R2 region. Azure Blob would be a separate sink type.

---

### DEC-5: Each data platform gets its own sink (Q21)

Webhook is the generic escape hatch. ClickHouse, PostHog, BigQuery
etc. each need their own `Sink` implementation with proper schema
mapping. The `Sink` interface is the right abstraction — one factory
entry + one class per platform.

---

### DEC-6: Delete TUI (Q23)

Remove `src/tui/` (6 files), `--tui` flag, help text references.

---

### DEC-7: Keep daemon mode (Q26)

All 3 modes stay: daemon (`jin start`), foreground
(`jin start --foreground`), OS service (`jin service install`).
Fix PID file scattering instead of dropping daemon.

---

### DEC-8: Remove `--service` from `jin start` (Q27)

Clean verb separation: `jin start` = run now, `jin service install` =
configure OS to run on boot. Different operations, different commands.

---

### DEC-9: Pricing as external file (Q7)

Ship `pricing.json` alongside binary. Updatable independently of
binary releases. Can be seeded from Prismatic in enterprise setups.
Deferred to Phase 7.

---

### DEC-10: macOS launchd resource limits (Q28)

Gap: Linux systemd unit has MemoryMax/CPUQuota/TasksMax. macOS plist
has no equivalent beyond `ProcessType=Background`. Deferred to Phase 7.

---

### DEC-11: Defer config hot reload from v2

For v2, the daemon snapshots config at startup. If the user runs
`jin connect` or edits `config.json` while the daemon is already running,
those changes do **not** apply until restart (`jin restart`, or
`jin stop` + `jin start`).

**Why defer hot reload:** config reload crosses too many unstable boundaries
at once during the rewrite: config lifetime, sink connection reconciliation,
routing behavior, in-flight pushes, and failure recovery. A naive file-watch
reload would add state-management complexity exactly where v2 is trying to
make ownership and runtime behavior simpler.

**Important nuance:** the push backlog does not require a special rebuild.
It is query-derived from store state plus `_jin_push_log`.

- New sink: no push history for that sink, so historical conversations
  naturally qualify for backfill.
- New route to an existing sink: conversations newly matching that route
  also qualify if they have never been pushed to that sink.
- Removed or narrowed route: affects future pushes only. v2 does not define
  remote delete/unpublish semantics.

**Follow-up direction:** if hot reload becomes a priority later, implement it
as an explicit reconcile-at-safe-boundary flow (`jin reload` or equivalent),
not as ad hoc mid-cycle mutation from a raw config file watcher.

---

## Pending Verification

### PENDING-1: Model data per-message availability (Q16)

Model is on both `conversations.model` and `messages.model` in v2.
Need to verify against real source data:

- [ ] Claude Code: is `message.model` on every record or just assistant?
- [x] Codex: model is in `turn_context` (emitted per-turn, not per-message).
  Field: `turn_context.payload.model` (e.g. `"gpt-5.4"`). Also in
  `turn_context.payload.collaboration_mode.settings.model`. Session-level
  model is in `state_5.sqlite` `threads` table (via `model_provider`), but
  the actual model name is only in the JSONL `turn_context`. Reasoning effort
  is at `collaboration_mode.settings.reasoning_effort` (e.g. `"xhigh"`).
  See `docs/adapters/codex/examples.md` Section 2.3 for raw sample.
- [ ] Cursor: is `modelConfig.modelName` per-bubble or per-composer?
- [ ] Any tool that switches models mid-conversation?
