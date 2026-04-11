# W3-PERF-01 Codex RSS Validation

## Scope

- validation date: `2026-04-07`
- packet: `W3-PERF-01`
- representative dataset: local `~/.codex` on this machine
- dataset scope at run time:
  - `106` `.jsonl` files under `~/.codex/sessions` and `~/.codex/archived_sessions`
  - `181` conversation refs returned by `CodexAdapter.findChanged({ kind: "startup-scan" })`

This artifact replaces the earlier heartbeat-only claim with a reviewable,
reproducible packet-local run.

## Exact Harness

Run from the canonical repo checkout:

```sh
cat >/tmp/jin-w3-perf-rss-ingestone.ts <<'EOF'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CodexAdapter } from "/Users/edenmendel/Documents/GitHub/jin/src/adapters/codex";
import { openStoreAtPath } from "/Users/edenmendel/Documents/GitHub/jin/src/db/store";
import { ingestOne } from "/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest";

function walkJsonl(dir: string, files: string[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      walkJsonl(fullPath, files);
      continue;
    }

    if (stats.isFile() && entry.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
}

function mb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

const codexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
const files: string[] = [];
for (const subdir of ["sessions", "archived_sessions"]) {
  const root = join(codexHome, subdir);
  if (existsSync(root)) {
    walkJsonl(root, files);
  }
}

await Bun.sleep(0);
Bun.gc(true);

const samples: Array<{ label: string; rss: number }> = [];
const capture = (label: string) => {
  samples.push({ label, rss: process.memoryUsage().rss });
};

capture("baseline");

const tempDir = mkdtempSync(join(tmpdir(), "jin-w3-perf-rss-"));
const store = openStoreAtPath(join(tempDir, "store.db"));
const originalWriteBundle = store.writeBundle.bind(store);
store.writeBundle = (bundle) => {
  capture("write:" + bundle.conversation.id);
  return originalWriteBundle(bundle);
};

const logger = {
  infos: [] as string[],
  warns: [] as string[],
  errors: [] as string[],
  info(message: string) {
    this.infos.push(String(message));
  },
  warn(message: string) {
    this.warns.push(String(message));
    capture("warn:" + String(message));
  },
  error(message: string) {
    this.errors.push(String(message));
    capture("error:" + String(message));
  },
};

const result = await ingestOne(
  new CodexAdapter(codexHome),
  store,
  { kind: "startup-scan" },
  {
    logger,
    batchSize: 20,
    onBatchProcessed: ({ processedRefs, totalRefs }) => {
      capture("batch:" + processedRefs + "/" + totalRefs);
    },
  },
);

capture("after-ingest");
Bun.gc(true);
await Bun.sleep(0);
capture("after-gc");

const peak = samples.reduce((best, sample) =>
  sample.rss > best.rss ? sample : best,
);
const hardLimitMentions = [...logger.warns, ...logger.errors].filter(
  (message) => message.includes("256 MB") || message.toLowerCase().includes("hard limit"),
);

const database = (store as { database?: { close?: () => void } }).database;
if (database?.close) {
  database.close();
}
rmSync(tempDir, { recursive: true, force: true });

console.log(JSON.stringify({
  codexHome,
  dataset: {
    jsonlFileCount: files.length,
    scannedRefCount: result.scannedRefCount,
    loadedConversationCount: result.loadedConversationCount,
  },
  rssMb: {
    baseline: mb(samples[0]?.rss ?? 0),
    peak: mb(peak?.rss ?? 0),
    peakLabel: peak?.label ?? null,
    afterGc: mb(samples.at(-1)?.rss ?? 0),
  },
  logger: {
    infoCount: logger.infos.length,
    warnCount: logger.warns.length,
    errorCount: logger.errors.length,
    hardLimitMentions,
    lastWarn: logger.warns.at(-1) ?? null,
    lastError: logger.errors.at(-1) ?? null,
  },
}, null, 2));
EOF
bun /tmp/jin-w3-perf-rss-ingestone.ts
```

## Measurement Method

- `Bun.gc(true)` runs before the baseline sample and again after ingest returns.
- `process.memoryUsage().rss` is sampled:
  - once at baseline
  - on every `store.writeBundle(...)`
  - on every `onBatchProcessed(...)` callback
  - once immediately after `ingestOne(...)` returns
  - once after the final forced GC
- The reported peak RSS is the maximum of those samples.
- Logger output is scanned for either `256 MB` or `hard limit`.

This harness matches the representative packet-local path cited in the review
blocker: real `~/.codex` input, `ingestOne(...)`, and a temp SQLite store.

## Observed Result

```json
{
  "codexHome": "/Users/edenmendel/.codex",
  "dataset": {
    "jsonlFileCount": 106,
    "scannedRefCount": 181,
    "loadedConversationCount": 181
  },
  "rssMb": {
    "baseline": 35.8,
    "peak": 224.4,
    "peakLabel": "write:019d6b2a-1562-7201-ad16-c8dc751a15fe",
    "afterGc": 224.4
  },
  "logger": {
    "infoCount": 0,
    "warnCount": 0,
    "errorCount": 0,
    "hardLimitMentions": [],
    "lastWarn": null,
    "lastError": null
  }
}
```

## Result Summary

- loaded-ref count: `181`
- peak RSS: `224.4 MB`
- headroom under the BP-02 hard limit: `31.6 MB`
- explicit hard-limit confirmation: no log line containing `256 MB` or `hard limit` appeared in the harness logger output
- representative-path status: the approved packet-local Codex ingest path stayed below the `256 MB` guard on the real local dataset

## Installed-Binary E2E Sufficiency

This artifact is sufficient to rerun the installed-binary E2E path because it
records the exact representative harness, dataset scope, measurement method,
loaded-ref count, peak RSS, and the absence of hard-limit output on the
packet-local validation path.

It is not a substitute for rerunning installed-binary E2E. It is the approval
artifact that removes the evidence gap before that rerun.
