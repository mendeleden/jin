#!/usr/bin/env bun
/**
 * codex-trace-session.ts
 *
 * Drives Codex CLI through multiple scenarios (exec, resume, fork) with
 * identifiable markers, then audits all storage layers to build a complete
 * picture of where data lands.
 *
 * Inspired by tools/cursor-trace-session.ts — same approach, different tool.
 *
 * Usage: bun tools/codex-trace-session.ts
 */

import { spawnSync, spawn as nodeSpawn } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const CODEX = "/Applications/Codex.app/Contents/Resources/codex";
const HOME = homedir();
const CODEX_HOME = process.env.CODEX_HOME || join(HOME, ".codex");
const CWD = "/Users/edenmendel/Documents/GitHub/jin";
const STATE_DB = join(CODEX_HOME, "state_5.sqlite");

// ── Formatting ──────────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const TRACE_ID = "JIN-CODEX-TRACE";
const MAGIC = "\u{1F50D}\u{1F994}"; // 🔍🦔

// ── Helpers ─────────────────────────────────────────────────────────

function sqlite3(db: string, query: string): string {
  try {
    return execSync(`sqlite3 "${db}" "${query}"`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch (e: any) {
    return `[sqlite3 error: ${e.message?.slice(0, 100)}]`;
  }
}

function findSessionFiles(): string[] {
  const sessionsDir = join(CODEX_HOME, "sessions");
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const s = statSync(full);
          if (s.isFile() && entry.endsWith(".jsonl")) files.push(full);
          else if (s.isDirectory()) walk(full, depth + 1);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  };
  walk(sessionsDir, 0);
  return files;
}

/** Run codex exec with --json flag and capture all JSONL events */
async function codexExec(prompt: string, extraArgs: string[] = []): Promise<{
  events: any[];
  threadId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const args = [
    "exec",
    "--json",
    "--sandbox", "read-only",
    "-C", CWD,
    ...extraArgs,
    prompt,
  ];

  console.log(dim(`  $ codex ${args.join(" ").slice(0, 120)}...`));

  return new Promise((resolve) => {
    const proc = nodeSpawn(CODEX, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";
    const events: any[] = [];
    let threadId = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line.trim());
          events.push(evt);
          if (evt.type === "thread.started" && evt.thread_id) {
            threadId = evt.thread_id;
          }
          // Live progress
          if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
            process.stdout.write(dim(`  [msg] ${evt.item.text?.slice(0, 80) || ""}...\n`));
          } else if (evt.type === "turn.completed") {
            const u = evt.usage;
            if (u) process.stdout.write(dim(`  [usage] in:${u.input_tokens} out:${u.output_tokens} cached:${u.cached_input_tokens || 0}\n`));
          } else if (evt.type === "item.completed" && evt.item?.type) {
            process.stdout.write(dim(`  [${evt.item.type}] completed\n`));
          }
        } catch { /* not JSON */ }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({ events, threadId, stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ events, threadId, stdout, stderr: stderr + err.message, exitCode: 1 });
    });
  });
}

/** Run codex exec resume with --json */
async function codexExecResume(threadId: string, prompt: string): Promise<{
  events: any[];
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const args = [
    "exec",
    "resume",
    "--json",
    threadId,
    prompt,
  ];

  console.log(dim(`  $ codex ${args.join(" ").slice(0, 120)}...`));

  return new Promise((resolve) => {
    const proc = nodeSpawn(CODEX, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";
    const events: any[] = [];

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line.trim());
          events.push(evt);
          if (evt.type === "turn.completed") {
            const u = evt.usage;
            if (u) process.stdout.write(dim(`  [usage] in:${u.input_tokens} out:${u.output_tokens}\n`));
          }
        } catch { /* not JSON */ }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => resolve({ events, stdout, stderr, exitCode: code ?? 1 }));
    proc.on("error", (err) => resolve({ events, stdout, stderr: stderr + err.message, exitCode: 1 }));
  });
}

// ── Storage Audit ───────────────────────────────────────────────────

function auditStorage(threadId: string, tag: string) {
  console.log(`\n${cyan("── Storage Audit for")} ${bold(tag)} ${dim(`(${threadId})`)}`);

  // Layer 1: state_5.sqlite threads table
  const threadRow = sqlite3(STATE_DB,
    `SELECT id, title, source, tokens_used, substr(first_user_message,1,60) FROM threads WHERE id='${threadId}';`
  );
  if (threadRow) {
    console.log(green("  [Layer 1] state_5.sqlite threads: FOUND"));
    console.log(dim(`    ${threadRow}`));
  } else {
    console.log(red("  [Layer 1] state_5.sqlite threads: NOT FOUND"));
  }

  // Layer 1: logs for this thread
  const logCount = sqlite3(STATE_DB,
    `SELECT count(*) FROM logs WHERE thread_id='${threadId}';`
  );
  console.log(dim(`  [Layer 1] logs for thread: ${logCount} entries`));

  // Layer 1: dynamic tools
  const toolCount = sqlite3(STATE_DB,
    `SELECT count(*) FROM thread_dynamic_tools WHERE thread_id='${threadId}';`
  );
  console.log(dim(`  [Layer 1] dynamic_tools: ${toolCount}`));

  // Layer 2: session JSONL
  const sessionFiles = findSessionFiles().filter(f => f.includes(threadId));
  if (sessionFiles.length > 0) {
    for (const f of sessionFiles) {
      const lines = readFileSync(f, "utf-8").split("\n").filter(Boolean).length;
      const size = statSync(f).size;
      console.log(green(`  [Layer 2] Session JSONL: FOUND (${lines} lines, ${(size / 1024).toFixed(1)}KB)`));
      console.log(dim(`    ${f}`));

      // Check for our markers
      const content = readFileSync(f, "utf-8");
      const markerHits = (content.match(new RegExp(TRACE_ID, "g")) || []).length;
      const magicHits = (content.match(/🔍🦔/g) || []).length;
      console.log(dim(`    Markers: ${TRACE_ID} x${markerHits}, ${MAGIC} x${magicHits}`));

      // Check record types present
      const types = new Set<string>();
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try { types.add(JSON.parse(line).type); } catch {}
      }
      console.log(dim(`    Record types: ${[...types].join(", ")}`));
    }
  } else {
    console.log(red("  [Layer 2] Session JSONL: NOT FOUND"));
  }

  // Layer 3: session_index.jsonl
  const indexPath = join(CODEX_HOME, "session_index.jsonl");
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, "utf-8");
    const indexHit = indexContent.split("\n").find(l => l.includes(threadId));
    if (indexHit) {
      console.log(green("  [Layer 3] session_index.jsonl: FOUND"));
      console.log(dim(`    ${indexHit.slice(0, 120)}`));
    } else {
      console.log(red("  [Layer 3] session_index.jsonl: NOT FOUND"));
    }
  }

  // Layer 6: shell snapshot
  const snapshotPath = join(CODEX_HOME, "shell_snapshots", `${threadId}.sh`);
  if (existsSync(snapshotPath)) {
    const size = statSync(snapshotPath).size;
    console.log(green(`  [Layer 6] Shell snapshot: FOUND (${(size / 1024).toFixed(1)}KB)`));
  } else {
    console.log(dim("  [Layer 6] Shell snapshot: not found"));
  }
}

function preFlightSnapshot() {
  const threadCount = sqlite3(STATE_DB, "SELECT count(*) FROM threads;");
  const sessionFiles = findSessionFiles();
  const indexLines = existsSync(join(CODEX_HOME, "session_index.jsonl"))
    ? readFileSync(join(CODEX_HOME, "session_index.jsonl"), "utf-8").split("\n").filter(Boolean).length
    : 0;
  return { threadCount: parseInt(threadCount) || 0, sessionFileCount: sessionFiles.length, indexLines };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(bold(`\n${"═".repeat(60)}`));
  console.log(bold(`  CODEX STORAGE TRACE EXPERIMENT`));
  console.log(bold(`  Markers: [${TRACE_ID}-XX] ${MAGIC}`));
  console.log(bold(`  CWD: ${CWD}`));
  console.log(bold(`${"═".repeat(60)}\n`));

  // Pre-flight: snapshot current state
  const before = preFlightSnapshot();
  console.log(dim(`Pre-flight: ${before.threadCount} threads, ${before.sessionFileCount} session files, ${before.indexLines} index entries\n`));

  const results: { phase: string; threadId: string; events: number; eventTypes: string[] }[] = [];

  // ── Phase 1: Simple exec (regular chat) ───────────────────────────
  console.log(`${cyan("━".repeat(60))}`);
  console.log(`${cyan("PHASE 1:")} ${bold("Simple exec — regular chat")}`);
  console.log(`${cyan("━".repeat(60))}`);

  const phase1 = await codexExec(
    `[${TRACE_ID}-01] ${MAGIC} You are in a traced session. List the files in src/adapters/ and tell me which adapters exist. Keep your answer under 5 sentences.`
  );

  console.log(`\n  Thread ID: ${bold(phase1.threadId)}`);
  console.log(`  Exit code: ${phase1.exitCode}`);
  console.log(`  Events: ${phase1.events.length}`);
  const p1types = [...new Set(phase1.events.map(e => `${e.type}${e.subtype ? `.${e.subtype}` : ""}`))];
  console.log(`  Event types: ${p1types.join(", ")}`);

  if (phase1.exitCode !== 0) {
    console.log(red(`\n  STDERR: ${phase1.stderr.slice(0, 500)}`));
  }

  results.push({ phase: "1-simple-exec", threadId: phase1.threadId, events: phase1.events.length, eventTypes: p1types });

  // Audit storage after phase 1
  if (phase1.threadId) {
    await new Promise(r => setTimeout(r, 2000)); // let disk flush
    auditStorage(phase1.threadId, "Phase 1 (simple exec)");
  }

  // ── Phase 2: Resume (multi-turn) ─────────────────────────────────
  if (phase1.threadId) {
    console.log(`\n${cyan("━".repeat(60))}`);
    console.log(`${cyan("PHASE 2:")} ${bold("Resume — multi-turn continuation")}`);
    console.log(`${cyan("━".repeat(60))}`);

    const phase2 = await codexExecResume(
      phase1.threadId,
      `[${TRACE_ID}-02] ${MAGIC} This is a RESUMED session. You should have context from the previous turn where you listed adapters. Now read src/adapters/codex.ts and tell me the top 3 record types it handles. Keep answer under 5 sentences.`
    );

    console.log(`\n  Exit code: ${phase2.exitCode}`);
    console.log(`  Events: ${phase2.events.length}`);
    const p2types = [...new Set(phase2.events.map(e => `${e.type}${e.subtype ? `.${e.subtype}` : ""}`))];
    console.log(`  Event types: ${p2types.join(", ")}`);

    if (phase2.exitCode !== 0) {
      console.log(red(`\n  STDERR: ${phase2.stderr.slice(0, 500)}`));
    }

    results.push({ phase: "2-resume", threadId: phase1.threadId, events: phase2.events.length, eventTypes: p2types });

    await new Promise(r => setTimeout(r, 2000));
    auditStorage(phase1.threadId, "Phase 2 (after resume)");
  }

  // ── Phase 3: Ephemeral exec (should NOT persist) ──────────────────
  console.log(`\n${cyan("━".repeat(60))}`);
  console.log(`${cyan("PHASE 3:")} ${bold("Ephemeral exec — should NOT persist")}`);
  console.log(`${cyan("━".repeat(60))}`);

  const phase3 = await codexExec(
    `[${TRACE_ID}-03] ${MAGIC} This is an EPHEMERAL session. Just say "ACK-EPHEMERAL" and nothing else.`,
    ["--ephemeral"]
  );

  console.log(`\n  Thread ID: ${bold(phase3.threadId || "NONE")}`);
  console.log(`  Exit code: ${phase3.exitCode}`);
  console.log(`  Events: ${phase3.events.length}`);

  if (phase3.threadId) {
    await new Promise(r => setTimeout(r, 2000));
    auditStorage(phase3.threadId, "Phase 3 (ephemeral — expect NOT FOUND)");
  }
  results.push({ phase: "3-ephemeral", threadId: phase3.threadId, events: phase3.events.length, eventTypes: [...new Set(phase3.events.map(e => e.type))] });

  // ── Phase 4: New exec with tool use trigger ───────────────────────
  console.log(`\n${cyan("━".repeat(60))}`);
  console.log(`${cyan("PHASE 4:")} ${bold("Exec with tool calls — read files")}`);
  console.log(`${cyan("━".repeat(60))}`);

  const phase4 = await codexExec(
    `[${TRACE_ID}-04] ${MAGIC} Read the file src/config.ts and tell me what the DEFAULT_CONFIG contains. Then read package.json and tell me the project name. Keep answer under 5 sentences.`
  );

  console.log(`\n  Thread ID: ${bold(phase4.threadId)}`);
  console.log(`  Exit code: ${phase4.exitCode}`);
  console.log(`  Events: ${phase4.events.length}`);

  // Count tool-related events
  const toolEvents = phase4.events.filter(e =>
    e.type === "item.completed" && (e.item?.type === "command_execution" || e.item?.type === "file_read" || e.item?.type === "mcp_tool_call")
  );
  console.log(`  Tool events: ${toolEvents.length}`);

  if (phase4.threadId) {
    await new Promise(r => setTimeout(r, 2000));
    auditStorage(phase4.threadId, "Phase 4 (with tool calls)");
  }
  results.push({ phase: "4-tool-calls", threadId: phase4.threadId, events: phase4.events.length, eventTypes: [...new Set(phase4.events.map(e => e.type))] });

  // ── Post-flight: diff against pre-flight ──────────────────────────
  const after = preFlightSnapshot();
  console.log(`\n${green("═".repeat(60))}`);
  console.log(green("POST-FLIGHT DIFF"));
  console.log(green("═".repeat(60)));
  console.log(`  Threads:       ${before.threadCount} → ${after.threadCount} (+${after.threadCount - before.threadCount})`);
  console.log(`  Session files: ${before.sessionFileCount} → ${after.sessionFileCount} (+${after.sessionFileCount - before.sessionFileCount})`);
  console.log(`  Index entries: ${before.indexLines} → ${after.indexLines} (+${after.indexLines - before.indexLines})`);

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n${green("═".repeat(60))}`);
  console.log(green("EXPERIMENT SUMMARY"));
  console.log(green("═".repeat(60)));
  for (const r of results) {
    console.log(`  ${r.phase.padEnd(25)} thread:${(r.threadId || "none").slice(0, 8).padEnd(10)} events:${String(r.events).padStart(4)} types:[${r.eventTypes.slice(0, 5).join(",")}]`);
  }

  // Dump all events from phase 1 as a reference for the JSONL event schema
  const eventsFile = join(CWD, "docs/adapters/codex/trace-events-phase1.jsonl");
  if (phase1.events.length > 0) {
    const { writeFileSync, mkdirSync } = await import("fs");
    mkdirSync(join(CWD, "docs/adapters/codex"), { recursive: true });
    writeFileSync(eventsFile, phase1.events.map(e => JSON.stringify(e)).join("\n") + "\n");
    console.log(`\n  Phase 1 events saved to: ${dim(eventsFile)}`);
  }

  console.log(green(`\n${"═".repeat(60)}`));
}

main().catch(e => {
  console.error(red(`Fatal: ${e.message}`));
  process.exit(1);
});
