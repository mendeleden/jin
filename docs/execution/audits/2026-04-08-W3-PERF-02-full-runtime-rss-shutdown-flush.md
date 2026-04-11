# W3-PERF-02 Full Runtime RSS / Shutdown Flush Validation

## Scope

- validation date: `2026-04-08`
- packet: `W3-PERF-02`
- representative workload:
  - local `~/.codex` on this machine
  - active runtime config at `~/.config/jin/config.json`
  - live local store at `~/.config/jin/store.db`
- dataset scope at run time:
  - `111` Codex `.jsonl` files under `~/.codex/sessions` and
    `~/.codex/archived_sessions`
  - `188` Codex refs returned by startup scan
  - `180` Railway-targeted conversations already carrying push errors in the
    local store

## RCA

The remaining real-runtime RSS failure was not the already-fixed Codex
`loadConversation()` path by itself.

The packet-local breakpoints showed three distinct layers:

1. `CodexAdapter.findChanged({ kind: "startup-scan" })` still retained too much
   RSS because `scanFileIndex()` read each JSONL file into one giant string with
   `readFileSync(...)`.
   - pre-fix: `baseline 30.9 MB -> afterFindChanged 149.4 MB`
   - post-fix: `baseline 30.9 MB -> afterFindChanged 101.4 MB`
2. The long-lived runtime still exceeded the guard after startup because
   `pushDirty()` constructed multi-conversation payload batches on top of the
   already-warm ingest process.
   - packet-local startup sequence with a no-op sink:
     - after ingest: `178.3 MB`
     - after `pushDirty()` with batch size `20`: `276.1 MB`
     - after `pushDirty()` with batch size `2`: `224.9 MB`
3. The remote Postgres sink is still failing independently of the RSS fix.
   - local `_jin_push_state.last_error`: `Only use sql.begin, sql.reserved or max: 1`
   - remote rows stayed `0/0`

That means the remaining RSS blocker was inside packet-owned runtime/adapter
composition:

- discovery indexing was still out of contract for memory
- runtime push batching was too wide for the real backlog shape

It was **not** a sink-internal memory-retention bug.

## Code Changes

- `src/adapters/codex.ts`
  - replaced `scanFileIndex()`'s full-file `readFileSync(...)` scan with the
    existing streaming JSONL reader so startup discovery obeys the same bounded
    memory contract as full loads
  - updated the private file-index/session-index helpers to async so the
    streaming scan stays packet-local and deterministic
- `src/commands/watch.ts`
  - set the long-lived runtime `pushBatchSize` to `2` so foreground/daemon
    store->sink work stays inside the BP-02 RSS budget on the real backlog
    shape while leaving the frozen runtime RSS thresholds on the pipeline
    defaults (`200 MB` warning / `256 MB` hard limit)
- `src/db/bundle.ts`
  - rewrote `computeBundleHash()` to incremental JSON emission while preserving
    the legacy canonical hash output
- `test/runtime-store-cutover.test.ts`
  - asserts the runtime path now passes `pushBatchSize: 2`
- `test/db-store-spine.test.ts`
  - adds a legacy-hash parity check so the hash rewrite stays semantically exact

## Exact Commands

### Focused tests

```sh
bun test test/runtime-store-cutover.test.ts
bun test test/codex-reference-adapter.test.ts \
  test/db-store-spine.test.ts \
  test/pipeline-spec-gap-closure.test.ts \
  test/pipeline-spine.test.ts
```

### Discovery-only RSS breakpoint

```sh
bun -e '
import { CodexAdapter } from "./src/adapters/codex";
const adapter = new CodexAdapter();
const mb = (b:number)=>Number((b/(1024*1024)).toFixed(1));
await Bun.sleep(0);
Bun.gc(true);
await Bun.sleep(0);
const baseline = mb(process.memoryUsage().rss);
const refs = await adapter.findChanged({kind:"startup-scan"});
await Bun.sleep(0);
Bun.gc(true);
await Bun.sleep(0);
console.log(JSON.stringify({
  baseline,
  afterFindChanged: mb(process.memoryUsage().rss),
  scannedRefs: refs.length
}, null, 2));
'
```

Observed result:

```json
{
  "baseline": 30.9,
  "afterFindChanged": 101.4,
  "scannedRefs": 188
}
```

### Representative Codex ingest harness on the current dataset

```sh
cat >/tmp/jin-w3-perf02-postpatch-harness.ts <<'EOF'
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CodexAdapter } from "/Users/edenmendel/Documents/GitHub/jin/src/adapters/codex";
import { openStoreAtPath } from "/Users/edenmendel/Documents/GitHub/jin/src/db/store";
import { ingestOne } from "/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest";

function mb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

async function gc(): Promise<number> {
  await Bun.sleep(0);
  Bun.gc(true);
  await Bun.sleep(0);
  return mb(process.memoryUsage().rss);
}

async function runCase(label: string, seedLiveStore: boolean) {
  const tempDir = mkdtempSync(join(tmpdir(), "jin-w3-perf02-" + label + "-"));
  const storePath = join(tempDir, "store.db");
  if (seedLiveStore) {
    copyFileSync(join(process.env.HOME ?? "", ".config/jin/store.db"), storePath);
  }

  const adapter = new CodexAdapter();
  const store = openStoreAtPath(storePath);
  const samples: Array<{ processedRefs: number; rssMb: number }> = [];
  let peak = await gc();
  const result = await ingestOne(adapter, store, { kind: "startup-scan" }, {
    onBatchProcessed: async ({ processedRefs }) => {
      const rssMb = await gc();
      peak = Math.max(peak, rssMb);
      if (processedRefs <= 5 || processedRefs % 25 === 0) {
        samples.push({ processedRefs, rssMb });
      }
    },
  });
  const finalRss = await gc();
  peak = Math.max(peak, finalRss);
  const dirty = store.conversationsNeedingPush("team-railway-postgres").length;
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
  return {
    label,
    seedLiveStore,
    scanned: result.scannedRefCount,
    loaded: result.loadedConversationCount,
    changed: result.changedConversationIds.length,
    dirty,
    peak,
    finalRss,
    samples,
  };
}

console.log(JSON.stringify([
  await runCase("empty", false),
  await runCase("copy", true),
], null, 2));
EOF
bun /tmp/jin-w3-perf02-postpatch-harness.ts
```

Observed result:

```json
[
  {
    "label": "empty",
    "seedLiveStore": false,
    "scanned": 188,
    "loaded": 188,
    "changed": 188,
    "dirty": 188,
    "peak": 153.4,
    "finalRss": 153.4
  },
  {
    "label": "copy",
    "seedLiveStore": true,
    "scanned": 188,
    "loaded": 188,
    "changed": 2,
    "dirty": 189,
    "peak": 175.6,
    "finalRss": 175.6
  }
]
```

### Integrated startup-sequence breakpoint for push batching

```sh
bun /tmp/jin-w3-perf02-startup-noop-batch2.ts
```

Observed result:

```json
{
  "pushResult": {
    "sinkAttempts": 94,
    "pushedConversations": 180,
    "failedConversations": 0
  },
  "peak": {
    "label": "after-pushDirty",
    "rssMb": 224.9
  }
}
```

### Real foreground runtime validation

```sh
bun src/index.ts start --foreground
```

Sampled in parallel:

```sh
ps -o pid=,rss=,vsz=,etime=,command= -p <pid>
sqlite3 ~/.config/jin/store.db "
  select count(*) from _jin_push_state
    where sink_id = 'team-railway-postgres' and last_successful_revision > 0;
  select count(*) from _jin_push_state
    where sink_id = 'team-railway-postgres' and last_error <> '';
  select substr(last_error, 1, 120) from _jin_push_state
    where sink_id = 'team-railway-postgres' and last_error <> '' limit 1;
"
RAILWAY_PG=$(jq -r '.sinks[] | select(.id=="team-railway-postgres") | .connectionString // .connection_string // empty' ~/.config/jin/config.json)
echo -n 'conversations='
psql "$RAILWAY_PG" -Atqc "select count(*) from public.jin_conversations"
echo -n 'messages='
psql "$RAILWAY_PG" -Atqc "select count(*) from public.jin_messages"
```

Observed runtime output:

```text
[2026-04-08 05:02:41] WARNING: RSS 205 MB is above the 200 MB warning threshold during ingest batch for adapter codex (109/188)
[2026-04-08 05:02:42] Skipping disabled sink team-local-postgres
```

Observed sampled RSS:

- `222528 KB` (`~217.3 MB`) at `00:05`
- `235408 KB` (`~229.9 MB`) at `00:20`

Observed log grep after the run:

```text
[2026-04-08 05:02:41] WARNING: RSS 205 MB is above the 200 MB warning threshold during ingest batch for adapter codex (109/188)
[2026-04-08 05:03:15] WARNING: Shutdown budget exceeded while flushing pipeline work
[2026-04-08 05:03:15] Shutdown budget exceeded — abandoning in-flight work.
```

Important negative evidence:

- no `RSS ... exceeded the 256 MB hard limit during ingest-adapter`
- no `RSS ... exceeded the 256 MB hard limit during shutdown-flush`
- no `RSS ... exceeded the 256 MB hard limit during pipeline work item push`

Observed local push state after the run:

```text
successful revisions: 0
errored revisions:    180
sample error:         Only use sql.begin, sql.reserved or max: 1
```

Observed remote Postgres row counts after the run:

```text
conversations=0
messages=0
```

## Result Summary

- The real foreground runtime no longer trips the BP-02 hard limit on the live
  workload.
- The warning threshold still fires as expected (`205 MB`), so the guard is
  still active.
- Manual shutdown still respects the BP-07 bounded-drain contract by timing out
  after `15s`; it no longer fails because `shutdown-flush` itself hit the RSS
  hard limit.
- Real push-to-Postgres is **still not restored**. The runtime stays alive long
  enough to try, but Railway rows remain `0/0` because the existing sink path is
  returning `Only use sql.begin, sql.reserved or max: 1` for each attempt.
