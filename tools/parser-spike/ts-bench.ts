#!/usr/bin/env bun
// Standalone benchmark: load a single Claude Code JSONL via the existing
// TS adapter, write the bundle to stdout-target file, print summary stats.
//
// Usage:
//   bun run tools/parser-spike/ts-bench.ts <jsonl-path> [out.json]
//
// We isolate the target by copying it into a temp projects dir layout so
// findChanged() returns only that file's refs.

import { mkdirSync, mkdtempSync, copyFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code";

const target = process.argv[2];
const outPath = process.argv[3] ?? "tools/parser-spike/bundle-ts.json";
if (!target) {
  console.error("usage: bun run ts-bench.ts <jsonl-path> [out.json]");
  process.exit(2);
}
const targetAbs = resolve(target);
const targetSize = statSync(targetAbs).size;

// Build temp projects dir mimicking ~/.claude/projects/<slug>/<file>.jsonl
const tmp = mkdtempSync(join(tmpdir(), "jin-ts-bench-"));
const projectsDir = join(tmp, "projects");
const projectSlug = "-spike-target";
const projectDir = join(projectsDir, projectSlug);
mkdirSync(projectDir, { recursive: true });
const stagedFile = join(projectDir, basename(targetAbs));
copyFileSync(targetAbs, stagedFile);

const adapter = new ClaudeCodeAdapter({ projectsDir });

const t0 = performance.now();
const memBefore = process.memoryUsage();

const refs = await adapter.findChanged({ kind: "startup-scan" });
const tFind = performance.now();

let totalMessages = 0;
let totalToolCalls = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheRead = 0;
let totalCacheWrite = 0;
let totalThinkingTokens = 0;
const bundles: unknown[] = [];

for (const ref of refs) {
  const bundle = await adapter.loadConversation(ref);
  if (!bundle) continue;
  bundle.conversation.sourcePath = targetAbs;
  bundles.push(bundle);
  totalMessages += bundle.messages.length;
  for (const m of bundle.messages) {
    totalToolCalls += m.toolUses.length;
    totalInputTokens += m.inputTokens;
    totalOutputTokens += m.outputTokens;
    totalCacheRead += m.cacheRead;
    totalCacheWrite += m.cacheWrite;
    totalThinkingTokens += m.thinkingTokens;
  }
}

const tLoad = performance.now();
const memAfter = process.memoryUsage();

const summary = {
  target: targetAbs,
  targetSizeBytes: targetSize,
  refsCount: refs.length,
  conversationsCount: bundles.length,
  totalMessages,
  totalToolCalls,
  totalInputTokens,
  totalOutputTokens,
  totalCacheRead,
  totalCacheWrite,
  totalThinkingTokens,
  timing: {
    findChangedMs: +(tFind - t0).toFixed(2),
    loadConversationMs: +(tLoad - tFind).toFixed(2),
    totalMs: +(tLoad - t0).toFixed(2),
  },
  memory: {
    rssDeltaMB: +((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2),
    rssPeakMB: +(memAfter.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: +(memAfter.heapUsed / 1024 / 1024).toFixed(2),
  },
};

writeFileSync(
  outPath,
  JSON.stringify({ summary, bundles }, null, 2),
);

console.error(JSON.stringify(summary, null, 2));
