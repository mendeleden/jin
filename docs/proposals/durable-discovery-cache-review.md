---
title: "Design Review: Durable Discovery Cache Instead of Persistent Discovery Workers"
status: review
created: 2026-04-17
reviews: docs/proposals/durable-discovery-cache.md
---

# Design Review — Durable Discovery Cache

Five reviewers, different backgrounds, independent passes. Each one owns a
lens. No synthesis rubber-stamping at the end — the consolidated verdict only
calls out places where two or more reviewers pushed on the same thing.

The proposal reads well and gets the framing right (*"this is a durability
problem, not a worker-lifetime problem"*). The pushback below is on
implementation detail, not direction.

---

## Reviewer A — Storage / SQLite background

### What I like

- Separate `discovery-cache.db`, not the canonical store. Good. Different
  durability class, different recovery story.
- Correctness-over-cache failure policy is stated explicitly ("never return
  wrong refs from stale cache"). That's the right invariant.
- Write-after-each-pass, not on-exit. Correct.

### What I want changed before this ships

1. **`payload_json` is the exact anti-pattern the v2 ontology rejected for
   `tool_uses`.** The ontology doc promotes `tool_calls` to a table
   *specifically* because queryable columns beat JSON blobs. Now we're
   proposing a JSON blob keyed by `(adapter_id, config_fingerprint,
   source_path)`. I don't object to the blob — discovery state is per-adapter
   and doesn't need to be cross-queryable — but the proposal should say
   *explicitly* why the ontology rule does not apply here. Otherwise this
   looks like cache-as-shortcut and the reviewer in two quarters who finds
   it won't know.

2. **Missing: a payload schema version *inside* `payload_json`.**
   `adapter_cache_meta.cache_version` covers the DB schema. It does not cover
   the shape of the adapter-owned blob. The current `Map<string,
   CachedFileIndex>` for Codex may become a different shape next quarter and
   you need to discard mismatched payloads without discarding the whole row.
   Add an adapter-owned `payload_version` field and have
   `importDiscoveryState` reject on mismatch.

3. **`config_fingerprint` is undefined.** What goes into it? Adapter config
   like `claudePath`, the jin CLI binary version, the adapter module hash?
   Pick one and write it down. "Adapter implementation version bump that
   changes discovery semantics" is an ops hand-grenade — no one remembers to
   bump it. Prefer a fingerprint derived automatically (e.g., hash of
   adapter module source or the adapter's declared `cacheVersion: number`).

4. **Concurrency on the cache DB.** One-shot worker per discovery request
   + periodic scans + fs-change hints means you *will* have overlapping
   workers. The proposal is silent on SQLite busy/WAL behavior. Recommend:
   WAL mode on the cache DB, `busy_timeout` set on connect, every write
   pass in one short `IMMEDIATE` transaction, and no reader/writer lock held
   across IPC.

5. **Crash partway through write.** If the worker dies after writing some
   rows but before the transaction commits, SQLite rolls back — good. But if
   the worker dies *after* commit but before sending the RPC response, the
   parent will retry and get duplicate refs. Either make the write
   idempotent (it looks like it is, via PK) or make the cache write
   transactional with the response (harder) — but say which.

---

## Reviewer B — Developer tools / CLI DX background

### What I like

- Explicit rejection of a resident helper. Agreed. Forever-lived helpers are
  a debugging tax nobody pays on day one and everybody pays on day 400.
- The operator mental model stays simple: one daemon, one store, one cache
  file. That's easy to explain and easy to wipe.

### Concerns

1. **Where's the `jin` surface?** If this cache is load-bearing for restart
   performance, operators need a way to:
   - see cache hit rate
   - see cache size
   - wipe it (`jin cache clear` or equivalent)
   - see *why* discovery invalidated (config change, adapter version, etc.)

   The proposal defines the storage but not the observability surface.
   At minimum, `jin status` should mention cache freshness per adapter, and
   there should be one command that nukes the cache safely. Otherwise the
   first time it silently misbehaves the only debugging tool is `rm`.

2. **Silent performance regression is the worst failure.** If fingerprinting
   is too aggressive, every restart quietly invalidates and the cache does
   nothing — but nothing alerts you. Please add a counter (even just a log
   line) like `discovery: adapter=codex cached=412 invalidated=0 fresh=3`
   at startup. Operators will recognize when that line changes.

3. **"Internal helper methods" is a euphemism.** `exportDiscoveryState()` /
   `importDiscoveryState()` are adapter contract surface. They're not
   public to external adapter authors, fine — but they *are* contract
   surface for anyone maintaining a heavy adapter. Document them in the
   adapter's own README and give them a test harness. "Internal" shouldn't
   mean "undocumented."

---

## Reviewer C — Performance / systems background

### The uncomfortable question

**Do we actually need a subprocess at all for discovery once the cache is
durable?**

The stated reason to run discovery in a worker is parent RSS. But:

- Claude Code's `fileIndexCache` is `Map<resolvedPath, {size, mtime, ...}>`.
  At 10K conversations that's tens of KB, not hundreds of MB.
- Codex's `fileIndexCache` is the same shape, same size class.
- Cursor's layer signatures and parent map are similarly lightweight.

The RSS problem during discovery isn't the cache — it's the *structural
rescan* of every source file. Once the cache is durable and mostly warm,
that rescan doesn't run on unchanged sources, and discovery's peak memory
drops to O(changed refs).

If that's true, the architecture simplifies dramatically:

- discovery runs **in-parent** (cheap, cache-hydrated)
- load runs **in-worker** (expensive, per-ref, already workerized)
- no discovery worker lifetime to manage at all

I'd like a measurement before committing to the discovery-worker-with-cache
shape. Specifically:

1. Current parent RSS during startup discovery on a real 10K-conversation
   Claude Code tree, *without* loadConversation running.
2. Same measurement with cache hydrated.
3. Fork+spawn cost of one discovery worker vs. in-process discovery with
   warm cache.

If (2) is bounded and (3) is dominated by the fork, the answer is
"discovery stays in the parent once cache is durable, and the worker path
is dead code we should delete." The proposal currently assumes the worker
path is still valuable post-cache. I don't think that's been shown.

### If we keep the worker path

- Spawning a Bun child per periodic scan is not free. Measure it.
- SQLite connection startup + `PRAGMA` setup per worker adds more.
- Consider: amortize by batching discovery across all heavy adapters into
  one worker invocation (`discover: [claude-code, codex, cursor]`) rather
  than N serialized workers.

---

## Reviewer D — Staff / architecture / BP background

### The layering is mostly clean

- BP-04 surface stays two-method. Good.
- Pipeline owns execution policy. Good.
- Store is not involved. Good.

### Where the proposal leaks

1. **`exportDiscoveryState` / `importDiscoveryState` are adapter contract.**
   Calling them "internal" doesn't make them internal. They're *required*
   for any heavy adapter that wants cache benefits; they're *forbidden* for
   adapters that don't. That's a two-tier adapter contract. Say so
   explicitly, and put it in BP-04 as a separate "Optional Heavy-Adapter
   Extension" section, not as an unwritten rule inside `src/adapters/`.

2. **Where does this run?** The proposal says the worker loads/persists
   discovery state. But the *adapter code* owns `exportDiscoveryState`.
   So the worker imports the adapter, calls `importDiscoveryState(blob)`,
   calls `findChanged()`, calls `exportDiscoveryState()`, writes blob.
   That means the adapter knows about the cache — or at least, about being
   hydrate-able. Fine, but state it: "Heavy adapters are aware of being
   resumable. They are *not* aware of the cache DB."

3. **Rollout step 4 is a big step.** "Route heavy findChanged() through
   one-shot JSON-RPC worker using the cache" hides at least five sub-steps:
   worker spawn, RPC contract extension, cache path threading, hydrate
   hook wiring, and error-path handling. Break this out, or at minimum
   add a risk statement.

4. **Relationship to `disk-backed-parent-write-session`.** The two
   proposals together change both the write path (parent staging) and the
   discovery path (durable cache). Please add one sentence stating the
   ingest order: *discovery cache hit → no load → no write*, so skip the
   staging path entirely. That's the actual end-state performance win and
   both proposals should acknowledge it.

---

## Reviewer E — SRE / reliability background

### Failure modes I want explicitly enumerated

The proposal covers three (config change, malformed payload, unreadable
source). I want four more:

1. **Clock skew / mtime lie.** A file's mtime went backward (restore from
   backup, `touch -d`, clock fix). The cache has a newer mtime, so it skips
   the file as unchanged. Rule: if the file's mtime is *earlier* than the
   cached mtime, treat it as changed (or invalidate).

2. **Size-equal, content-different.** The adapter cache says `size=12345,
   mtime=X`. The file was modified atomically to the same size within the
   same mtime second. For Claude Code JSONL this is implausible but for
   SQLite sources (Cursor, Warp) where we're hashing layer signatures, it's
   a real risk. Document which adapters rely on size+mtime alone and which
   also hash content.

3. **Cache DB locked / corrupt.** What does discovery do? Proposal says
   "fall back to uncached discovery" on write failure but doesn't cover
   read failure. Recommend: on any cache DB open/read error, log once,
   disable cache for the rest of the daemon lifetime, proceed with full
   discovery. Do not retry open on every scan.

4. **Two daemons accidentally running.** `jin start` twice (misconfigured
   systemd, user error). Two processes, one cache DB. SQLite handles it
   with WAL but the cache invalidation semantics are racy. Not proposing
   we solve this, just: document that the cache is assumed single-writer
   and linked to PID-file locking from elsewhere in the system.

### What I want in success criteria

The proposal's success criteria are shape-level ("no additional
forever-lived process", "parent RSS bounded"). I want numeric:

- Fresh-restart discovery time on 10K conversations: target < 2s.
- Cache hit rate after steady-state: target > 95%.
- Cache DB size after 6 months of typical use: target < 50MB.

Without numbers, "materially improve" is a wish.

---

## Consolidated points where multiple reviewers agreed

1. **Observability is missing.** Reviewers B, D, E. There is no
   `jin status` surface for cache state, no counters, no cache-clear
   command, no metrics. Add these before shipping.

2. **Fingerprinting is under-specified.** Reviewers A, D, E. What goes
   in, who bumps it, and what happens on mismatch need a concrete answer,
   not "adapter implementation version bump."

3. **`payload_json` needs its own version.** Reviewers A, D. The table
   schema version is not enough; the blob shape will evolve faster than
   the DB schema.

4. **Measure first; the worker may be unnecessary post-cache.**
   Reviewers C, D. The proposal assumes "durable cache + one-shot worker"
   is better than "persistent worker." It might be. But the *real*
   alternative worth benchmarking is "durable cache + in-parent
   discovery, no worker." If that works, delete a whole path.

5. **Heavy-adapter extension is contract surface.** Reviewers B, D.
   `exportDiscoveryState` / `importDiscoveryState` should be documented
   and tested like a contract, even if not on BP-04.

---

## Verdict

**Direction: approved.** Durable cache + one-shot worker is a better end
state than a resident discovery helper, for the reasons the proposal
states and for two more that the reviewers surfaced (observability,
restart symmetry).

**Implementation: not ready to land.** The fingerprinting story, blob
versioning, cache-DB concurrency, observability surface, and the
"do we even need the worker" question all need answers before code goes
in. A second draft that addresses the Consolidated points is probably
enough to close this.

**Biggest unlock we're missing:** the combination of
*durable cache + in-parent discovery + worker-only load + disk-backed
write session* might be the actual target architecture. Three proposals,
one shape. Worth an explicit end-state diagram before committing to the
worker-for-discovery path.

---

## Patch block — requested `Alternative Considered: Long-Running Discovery Worker` section

Drop this into `docs/proposals/durable-discovery-cache.md` after the
`## Explicit Rejection` section (or replace that section with it, since
this is the honest version of the same content):

````markdown
## Alternative Considered: Long-Running Discovery Worker

A resident discovery subprocess that spawns once per daemon lifetime and
preserves adapter-local discovery state in memory is a valid alternative.
It solves a narrower problem and is explicitly rejected here, but the
tradeoffs are real and worth stating in full.

### Arguments for

- Smallest implementation delta from the current codebase. Adapter
  in-memory state (e.g., `fileIndexCache`) is reused as-is, no
  serialization, no schema.
- Directly fixes repeated `findChanged()` replay during a single daemon
  lifetime, which is the observed pain today.
- No cache schema, no fingerprinting, no invalidation policy required to
  ship.
- Keeps discovery "hot" across startup → periodic → later periodic scans
  without any disk round-trip.
- Good fit if the problem we're solving is strictly "don't redo work
  while the daemon is already running."

### Arguments against

- Introduces another forever-lived subprocess category that has to be
  debugged, monitored, and reasoned about during shutdown, crashes,
  orphan cleanup, protocol drift, and stale-config reloads.
- Does not solve restart replay at all. Every `jin stop` / `jin start`
  pays the full cold discovery cost again.
- A crash or OOM-kill loses exactly the state the worker existed to
  preserve.
- Encourages a pattern where operational performance depends on helper
  lifetime rather than on durable state — a pattern that tends to
  accumulate more resident helpers over time.
- Harder to introspect: there is no artifact on disk you can inspect,
  wipe, or version.

### Why we are not choosing it

The cost of a resident helper is ongoing and paid by the next person who
has to debug daemon behavior. The cost of the durable cache is up-front
and paid once, by us. The restart-replay bug — which the resident
worker does not fix — is the original motivation, so solving only the
within-lifetime case does not actually close the ticket.

The resident-worker design may still exist as a short-term experiment
before durable cache lands, but it is not the target architecture.
````
