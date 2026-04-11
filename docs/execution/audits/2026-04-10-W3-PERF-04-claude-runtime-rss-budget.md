# W3-PERF-04 Claude Runtime RSS Budget Audit — 2026-04-10

**Packet:** `W3-PERF-04`  
**Scope:** `src/adapters/claude-code.ts`, `src/pipeline/ingest.ts`, `src/commands/watch.ts`, packet-owned tests

## Commands Run

### 1. Focused packet tests

```bash
bun test test/claude-code-reference-adapter.test.ts test/runtime-store-cutover.test.ts
```

Observed:

- `19` tests passed.
- Coverage now includes the Claude-specific single-ref ingest batching rule and
  the tighter adapter cache-eviction rule after `loadConversation()`.

### 2. Claude discovery-only RSS on the live dataset

```bash
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; Bun.gc?.(true); const adapter = new ClaudeCodeAdapter(); const before = Math.round(process.memoryUsage().rss / 1024 / 1024); const refs = await adapter.findChanged({ kind: "startup-scan" }); const after = Math.round(process.memoryUsage().rss / 1024 / 1024); Bun.gc?.(true); const afterGc = Math.round(process.memoryUsage().rss / 1024 / 1024); console.log(JSON.stringify({ refCount: refs.length, rssMb: { before, after, afterGc }, sampleRef: refs[0] ?? null }, null, 2));'
```

Observed after the streamed parser change:

- `921` refs discovered.
- RSS moved from `31 MB` to `199 MB` and stayed at `199 MB` after forced GC.
- Pre-fix discovery on the same machine had reached `364 MB`.

### 3. Largest isolated Claude `loadConversation()` probe

```bash
TARGET='/Users/edenmendel/.claude/projects/-Users-edenmendel-Documents-GitHub-earlywarning/36ef1cb3-e372-4b86-9856-2bcdb4de76e0/subagents/agent-a7b1815.jsonl' bun - <<'EOF'
import { ClaudeCodeAdapter } from "./src/adapters/claude-code";
const path = process.env.TARGET!;
Bun.gc?.(true);
const before = Math.round(process.memoryUsage().rss / 1024 / 1024);
const adapter = new ClaudeCodeAdapter({ projectsDir: path });
const refs = await adapter.findChanged({ kind: "startup-scan" });
const afterFind = Math.round(process.memoryUsage().rss / 1024 / 1024);
const bundle = refs[0] ? await adapter.loadConversation(refs[0]) : null;
const afterLoad = Math.round(process.memoryUsage().rss / 1024 / 1024);
Bun.gc?.(true);
const afterGc = Math.round(process.memoryUsage().rss / 1024 / 1024);
console.log(JSON.stringify({ path, refs: refs.length, messages: bundle?.messages.length ?? 0, rssMb: { before, afterFind, afterLoad, afterGc } }, null, 2));
EOF
```

Observed after the streamed parser change:

- the `20.96 MB` live Claude source above produced `1` ref and `20` messages
- RSS moved from `31 MB` to `121 MB` after discovery and `159 MB` after load
- this stayed below the `256 MB` hard limit
- pre-fix the same isolated load path had reached `234 MB`

### 4. Direct integrated startup ingest on a disposable store

```bash
bun - <<'EOF'
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ClaudeCodeAdapter } from "./src/adapters/claude-code";
import { ingestOne } from "./src/pipeline/ingest";
import { openStoreAtPath } from "./src/db/store";
const tempDir = mkdtempSync(join(tmpdir(), "jin-w3-perf-04-direct-"));
const store = openStoreAtPath(join(tempDir, "store.db"));
const adapter = new ClaudeCodeAdapter();
const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
const snapshots = [];
Bun.gc?.(true);
const before = rss();
try {
  const result = await ingestOne(adapter, store, { kind: "startup-scan" }, {
    logger: { info() {}, warn() {}, error(message, error) { console.error(message, error); } },
    onBatchProcessed: async (info) => {
      snapshots.push({ ...info, rssMb: rss() });
    },
  });
  Bun.gc?.(true);
  const firstAbove256 = snapshots.find((entry) => entry.rssMb > 256) ?? null;
  const maxRssMb = snapshots.reduce((max, entry) => Math.max(max, entry.rssMb), before);
  console.log(JSON.stringify({ beforeRssMb: before, afterRssMb: rss(), result: { scannedRefCount: result.scannedRefCount, loadedConversationCount: result.loadedConversationCount, changedConversationCount: result.changedConversationIds.length }, maxRssMb, firstAbove256, firstSnapshots: snapshots.slice(0, 8), lastSnapshot: snapshots.at(-1) ?? null }, null, 2));
} finally {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
}
EOF
```

Observed after the packet changes:

- `921` refs scanned
- `921` conversations loaded and changed on the disposable store
- first batch snapshot: `197 MB` at `(1/921)`
- max observed RSS: `228 MB`
- no batch crossed the `256 MB` hard limit

Pre-fix on the same machine, this path had reached roughly:

- `370 MB` at `(20/921)` with the default batch size
- `320 MB` even with `batchSize: 1` but without the streamed parser and tighter cache release

### 5. Real foreground startup command on a disposable config/store

```bash
python3 - <<'PY'
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import tempfile
from pathlib import Path

repo = Path('/Users/edenmendel/Documents/GitHub/jin')
tempdir = Path(tempfile.mkdtemp(prefix='jin-w3-perf-04-cli-'))
real_config_path = Path.home() / '.config' / 'jin' / 'config.json'
config = json.loads(real_config_path.read_text())
config['sinks'] = []
(tempdir / 'config.json').write_text(json.dumps(config, indent=2))
env = os.environ.copy()
env['JIN_CONFIG_DIR'] = str(tempdir)
proc = subprocess.Popen(
    ['bun', 'run', 'src/index.ts', 'start', '--foreground'],
    cwd=repo,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
try:
    output, _ = proc.communicate(timeout=20)
    timed_out = False
except subprocess.TimeoutExpired:
    timed_out = True
    proc.send_signal(signal.SIGTERM)
    try:
        output, _ = proc.communicate(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        output, _ = proc.communicate()

store_path = tempdir / 'store.db'
conversation_count = None
message_count = None
if store_path.exists():
    conn = sqlite3.connect(store_path)
    try:
        conversation_count = conn.execute('select count(*) from conversations').fetchone()[0]
        message_count = conn.execute('select count(*) from messages').fetchone()[0]
    finally:
        conn.close()
lines = output.splitlines()
print(json.dumps({
    'tempDir': str(tempdir),
    'timedOut': timed_out,
    'returnCode': proc.returncode,
    'conversationCount': conversation_count,
    'messageCount': message_count,
    'outputHead': lines[:15],
    'outputTail': lines[-15:],
}, indent=2))
shutil.rmtree(tempdir, ignore_errors=True)
PY
```

Observed on the real foreground path after the packet changes:

- runtime started with `Claude Code`, `Cursor`, `Codex`, and `Gemini CLI`
- warning triggered at `RSS 237 MB` during Claude ingest `(1/921)`
- hard limit still triggered at `RSS 268 MB` during Claude ingest `(306/921)`
- the disposable store reached `306` conversations / `8629` messages before shutdown

Pre-packet live service had died much earlier:

- `RSS 422 MB exceeded the 256 MB hard limit during ingest batch for adapter claude-code (20/921)`

## Interpretation

### What this packet closed

- Claude discovery no longer reads each JSONL transcript into one full process-wide string before indexing refs.
- Claude `loadConversation()` no longer leaves a full parsed source model pinned after the bundle has been materialized.
- Claude ingest now uses one-ref batches with explicit reclaim, which keeps the direct `ingestOne()` startup path below the frozen `256 MB` hard limit on the live `921`-ref dataset.
- The remaining failure is no longer evidence that a single valid Claude bundle cannot fit the frozen runtime budget. The largest isolated live load stayed at `159 MB`.

### What still fails

- The real foreground runtime still exceeds the hard limit on the multi-adapter startup path, but it now does so much later:
  - from `422 MB` at `(20/921)` before this packet
  - to `268 MB` at `(306/921)` after this packet

### Boundary conclusion

This no longer looks like a Claude adapter contract gap. The packet-owned
Claude adapter plus `ingestOne()` path are bounded enough in isolation.

The remaining `~40 MB` of live startup overhead appears to come from the
foreground/runtime integration layer around the ingest call rather than from a
single oversized `ConversationBundle`. Closing that remaining gap would likely
need a follow-on lane in runtime/control-plane code outside this packet’s owned
files.

## Files Changed

- `src/adapters/claude-code.ts`
- `src/pipeline/ingest.ts`
- `src/commands/watch.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/runtime-store-cutover.test.ts`

## Addendum — Honest Benchmark Rerun After Harness Fixes

After the main packet changes, two benchmark-harness follow-ups were required in
`src/commands/benchmark.ts`:

- preserve adapter reclaim hooks with the correct `this` binding
- preserve `store.database.exec()` on the tracked store wrapper
- fail a benchmark phase when the phase logger captured real runtime errors,
  instead of stamping `status: "ok"` unconditionally

Focused validation after that harness fix:

```bash
bun test test/perf-harness/benchmark-v2.test.ts test/runtime-store-cutover.test.ts
```

Observed:

- `10` tests passed
- benchmark wrapper coverage now proves production reclaim hooks are preserved
- benchmark store coverage now proves SQLite `database.exec()` is still exposed

Fresh honest benchmark rerun:

```bash
tmpdir=$(mktemp -d /tmp/jin-benchmark-rerun-XXXXXX) \
  && cp ~/.config/jin/config.json "$tmpdir/config.json" \
  && mkdir -p "$tmpdir/out" \
  && JIN_CONFIG_DIR="$tmpdir" JIN_BENCHMARK_OUTPUT_DIR="$tmpdir/out" \
     bun src/index.ts benchmark --json
```

Observed on `2026-04-10`:

- overall verdict: `fail`
- completed phases:
  - `discovery`
  - `load`
  - `load-write`
  - `push`
- failed phases:
  - `runtime`
  - `shutdown-flush`
- key runtime evidence:
  - runtime warning at `RSS 210 MB` during Claude ingest `(1/922)`
  - runtime hard limit hit after Claude completed and Cursor reached `20/96`
  - runtime counts at failure:
    - `refsTouched=1018`
    - `bundlesTouched=942`
    - adapters:
      - Claude `922/922` loaded
      - Cursor `20/96` loaded
      - Codex `0`
      - Gemini `0`
- shutdown-flush also failed honestly on the same frozen `256 MB` budget, at
  Claude `(6/922)`

Updated read:

- the benchmark wrapper drift is fixed
- the harness now reports the runtime lane honestly
- the remaining blocker is no longer “benchmark is lying” or “Claude adapter is
  obviously unbounded in isolation”
- the remaining blocker is integrated multi-adapter runtime RSS after the
  runtime has already finished Claude and starts into Cursor
