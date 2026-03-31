#!/usr/bin/env bun
/**
 * cursor-trace-session.ts
 *
 * Drives Cursor Agent through 15+ rounds of identifiable prompts.
 * Each prompt is tagged [JIN-TRACE-XX] so the conversation can be
 * traced through all of Cursor's storage layers (state.vscdb, JSONL
 * transcripts, store.db blobs) by another investigation thread.
 *
 * Usage: bun tools/cursor-trace-session.ts
 */

import { spawn } from "bun";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const CWD = "/Users/edenmendel/Documents/GitHub/jin";
let SESSION_ID = ""; // assigned after session/new

// ── ACP Client (same as before, streamlined) ────────────────────────

class AcpClient {
  private proc: any;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private lineBuffer = "";
  private chunks: string[] = [];
  private toolCount = 0;

  constructor() {
    this.proc = spawn({
      cmd: ["cursor", "agent", "acp"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.readStdout();
    this.readStderr();
  }

  private async readStdout() {
    const reader = this.proc.stdout.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.lineBuffer += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = this.lineBuffer.indexOf("\n")) !== -1) {
          const line = this.lineBuffer.slice(0, idx).trim();
          this.lineBuffer = this.lineBuffer.slice(idx + 1);
          if (line) this.handle(line);
        }
      }
    } catch {}
  }

  private async readStderr() {
    const reader = this.proc.stderr.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
      }
    } catch {}
  }

  private handle(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const w = this.pending.get(msg.id);
      if (w) { this.pending.delete(msg.id); msg.error ? w.reject(msg.error) : w.resolve(msg.result); }
      return;
    }

    if (msg.method === "session/update") {
      const u = msg.params?.update;
      if (!u) return;
      if (u.sessionUpdate === "agent_message_chunk" && u.content?.text) {
        process.stdout.write(u.content.text);
        this.chunks.push(u.content.text);
      } else if (u.sessionUpdate === "agent_thought_chunk" && u.content?.text) {
        process.stdout.write(dim(u.content.text));
      } else if (u.sessionUpdate === "tool_call") {
        this.toolCount++;
        console.log(`\n${yellow("⚡")} ${bold(u.title || "tool")} ${dim(`[${u.kind}]`)}`);
        if (u.locations?.length) {
          for (const loc of u.locations) console.log(dim(`   ${loc.path || JSON.stringify(loc)}`));
        }
      } else if (u.sessionUpdate === "tool_call_update" && u.status === "completed") {
        console.log(dim(`   ✓ done`));
      }
      return;
    }

    if (msg.id !== undefined && msg.method) {
      if (msg.method === "session/request_permission") {
        const opts = msg.params?.options ?? [];
        const allow = opts.find((o: any) => o.kind === "allow_once") || opts[0];
        console.log(green(`   → auto-approved: ${msg.params?.toolCall?.title || "action"}`));
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: allow?.optionId } });
      } else if (msg.method === "fs/read_text_file") {
        try {
          const content = require("fs").readFileSync(msg.params.path, "utf-8");
          this.respond(msg.id, { content });
        } catch (e: any) {
          this.respond(msg.id, { content: `[error: ${e.message}]` });
        }
      } else if (msg.method === "fs/write_text_file") {
        try {
          require("fs").writeFileSync(msg.params.path, msg.params.contents);
          this.respond(msg.id, {});
          console.log(green(`   ✓ wrote ${msg.params.path}`));
        } catch { this.respond(msg.id, {}); }
      } else {
        this.respond(msg.id, {});
      }
    }
  }

  private send(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
  }

  private respond(id: number, result: unknown) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  async init(): Promise<string> {
    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: "jin-trace-driver", version: "0.1.0" },
    });
    await this.send("authenticate", { methodId: "cursor_login" });
    const sess = await this.send("session/new", { cwd: CWD, mcpServers: [] });
    const sessionId = sess.sessionId;
    console.log(green(`Created session: ${sessionId}`));
    return sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<{ response: string; tools: number; stopReason: string }> {
    this.chunks = [];
    this.toolCount = 0;
    const result = await this.send("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    return { response: this.chunks.join(""), tools: this.toolCount, stopReason: result?.stopReason || "unknown" };
  }

  kill() {
    try { this.proc.stdin.end(); this.proc.kill(); } catch {}
  }
}

// ── Prompt sequence (generated after session creation to embed session ID) ──

const TRACE_ID = "JIN-TRACE";
const MAGIC = "🔍🦔"; // unique emoji pair for grep-ability

function buildPrompts(sessionId: string): { tag: string; text: string }[] {
  return [
    {
      tag: "01-ORIENTATION",
      text: `[${TRACE_ID}-01] ${MAGIC} ORIENTATION ROUND.
You are participating in a traced session. Every prompt I send has a unique tag like [JIN-TRACE-XX] and the emoji pair ${MAGIC}. These markers exist so another investigation can find this exact conversation in Cursor's storage layers (state.vscdb, JSONL transcripts, store.db blobs).

Your task across this session: audit and improve the Cursor adapter for the jin project.

Start by reading src/adapters/cursor.ts and src/adapters/types.ts. Tell me what the adapter does in 3 sentences.`
    },
    {
      tag: "02-LAYER-MAP",
      text: `[${TRACE_ID}-02] ${MAGIC} LAYER MAP ROUND.
Read docs/adapters/cursor/overview.md. This documents 4 storage layers where Cursor keeps conversation data. Summarize each layer in one line and tell me which ones the current adapter reads.`
    },
    {
      tag: "03-STORE-DB-DEEP-DIVE",
      text: `[${TRACE_ID}-03] ${MAGIC} STORE-DB DEEP DIVE.
The adapter currently only reads Layer 3 (store.db). Read the collectMessages() method carefully. List every type of blob content it MISSES — tool-call blocks, tool-result blocks, reasoning blocks, protobuf blobs. What data is lost?`
    },
    {
      tag: "04-STATE-VSCDB-RECON",
      text: `[${TRACE_ID}-04] ${MAGIC} STATE-VSCDB RECONNAISSANCE.
The richest data is in Layer 1: state.vscdb. Read docs/adapters/cursor/examples.md sections 1.1 through 1.5. Then check if the file exists on this system:
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
Report the file size and whether it's accessible.`
    },
    {
      tag: "05-VSCDB-SCHEMA-PROBE",
      text: `[${TRACE_ID}-05] ${MAGIC} VSCDB SCHEMA PROBE.
Run a shell command to query the state.vscdb database and count how many composerData and bubbleId entries exist right now. Use:
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" "SELECT CASE WHEN key LIKE 'composerData:%' THEN 'composerData' WHEN key LIKE 'bubbleId:%' THEN 'bubbleId' ELSE 'other' END as prefix, count(*) FROM cursorDiskKV GROUP BY prefix ORDER BY count(*) DESC LIMIT 5;"
Report the numbers.`
    },
    {
      tag: "06-FIND-THIS-SESSION",
      text: `[${TRACE_ID}-06] ${MAGIC} FIND THIS SESSION.
This is the meta-question: can you find THIS conversation we're having right now in Cursor's storage? Our session ID is ${sessionId}. Check:
1. Does composerData:${sessionId} exist in state.vscdb?
2. Does an agent-transcript JSONL exist for ${sessionId}?
3. Does a store.db exist for ${sessionId}?
Search for our session across all layers.`
    },
    {
      tag: "07-TRANSCRIPT-FORENSICS",
      text: `[${TRACE_ID}-07] ${MAGIC} TRANSCRIPT FORENSICS.
If you found a JSONL transcript for our session, read the first 10 lines. Do you see the [JIN-TRACE-01] marker from my first prompt? This proves the transcript captures user prompts verbatim. Report what you find.`
    },
    {
      tag: "08-BLOB-FORENSICS",
      text: `[${TRACE_ID}-08] ${MAGIC} BLOB FORENSICS.
If a store.db exists for our session, query it:
1. How many blobs does it contain?
2. What's in the meta row (decode hex)?
3. Can you find our ${MAGIC} markers in any blob content?
Run: sqlite3 <path>/store.db "SELECT count(*) FROM blobs;" and the meta decode.`
    },
    {
      tag: "09-EXISTING-TESTS",
      text: `[${TRACE_ID}-09] ${MAGIC} TEST AUDIT.
Read test/cursor-adapter.test.ts that was created earlier. Count the test cases by category (readSessionMeta, collectMessages, sessions, messages, detect, etc). Are there any gaps? What edge cases are missing?`
    },
    {
      tag: "10-TOOL-CALL-PARSING",
      text: `[${TRACE_ID}-10] ${MAGIC} TOOL CALL PARSING GAP.
The biggest gap in cursor.ts is that toolUses is always []. Read the docs/adapters/cursor/examples.md section 3.4 showing what tool-call and tool-result blobs look like. Then look at how other adapters handle tool calls — read src/adapters/claude-code.ts (or whichever adapter has the best tool parsing). Report what cursor.ts would need to extract toolUses.`
    },
    {
      tag: "11-THINKING-BLOCKS-GAP",
      text: `[${TRACE_ID}-11] ${MAGIC} THINKING BLOCKS GAP.
Same story for thinkingBlocks — always []. The reasoning blocks in store.db blobs have { type: "reasoning", text: "...", providerOptions: { cursor: { modelName: "..." } } }. What code changes would cursor.ts need to populate thinkingBlocks? Just describe the approach, don't write code yet.`
    },
    {
      tag: "12-LAYER1-ADAPTER-DESIGN",
      text: `[${TRACE_ID}-12] ${MAGIC} LAYER 1 ADAPTER DESIGN.
The recommended strategy from the docs is: Primary = Layer 1 (state.vscdb) for IDE sessions, Supplement = Layer 2 (JSONL) for CLI sessions. Design a plan for a new CursorVscdbAdapter class that reads from state.vscdb. What methods would it need? How would sessions() work (query composerData keys)? How would messages() work (query bubbleId keys)? Think through the API.`
    },
    {
      tag: "13-CROSS-ADAPTER-PATTERNS",
      text: `[${TRACE_ID}-13] ${MAGIC} CROSS-ADAPTER PATTERNS.
Read src/adapters/registry.ts to see how adapters are registered. Then skim 2-3 other adapter files (whichever exist) to understand common patterns. How do they handle detect(), sessions(), messages()? What patterns should the new Layer 1 adapter follow?`
    },
    {
      tag: "14-WAL-LOCKING",
      text: `[${TRACE_ID}-14] ${MAGIC} WAL AND LOCKING.
A critical concern: state.vscdb is actively used by Cursor IDE. What happens if we read it while Cursor is writing? Check if the database uses WAL mode:
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" "PRAGMA journal_mode;"
Also check: can we open it readonly while Cursor is running? Report findings.`
    },
    {
      tag: "15-SESSION-TRACE-SUMMARY",
      text: `[${TRACE_ID}-15] ${MAGIC} SESSION TRACE SUMMARY.
We're near the end of this traced session. Summarize what we've learned across all 15 rounds:
1. Which storage layers did we confirm exist on this system?
2. Could we find THIS session in the storage? Which layers?
3. Were the [JIN-TRACE-XX] markers visible in the stored data?
4. What are the top 3 things jin needs to do to properly track Cursor conversations?
5. What's the session ID (${sessionId}), how many rounds did we do, and approximately how many tool calls were made?

Include the markers one more time for searchability: [${TRACE_ID}-15] ${MAGIC}`
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const client = new AcpClient();

  try {
    SESSION_ID = await client.init();
    const prompts = buildPrompts(SESSION_ID);

    console.log(bold(`\n${"═".repeat(60)}`));
    console.log(bold(`  JIN TRACE SESSION — ${prompts.length} rounds`));
    console.log(bold(`  Session: ${SESSION_ID}`));
    console.log(bold(`  Markers: [${TRACE_ID}-XX] ${MAGIC}`));
    console.log(bold(`${"═".repeat(60)}\n`));

    const results: { tag: string; tools: number; stopReason: string; responseLen: number }[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      console.log(`\n${cyan("━".repeat(60))}`);
      console.log(`${cyan(`ROUND ${i + 1}/${prompts.length}`)} — ${bold(p.tag)}`);
      console.log(`${cyan("━".repeat(60))}\n`);

      const { response, tools, stopReason } = await client.prompt(SESSION_ID, p.text);
      results.push({ tag: p.tag, tools, stopReason, responseLen: response.length });

      console.log(dim(`\n[stop: ${stopReason}] [tools: ${tools}] [response: ${response.length} chars]`));

      // Small delay between rounds to let Cursor flush to disk
      await new Promise(r => setTimeout(r, 1000));
    }

    // Print summary table
    console.log(`\n\n${green("═".repeat(60))}`);
    console.log(green("SESSION COMPLETE — ROUND SUMMARY"));
    console.log(green("═".repeat(60)));
    console.log(`Session ID: ${SESSION_ID}`);
    console.log(`Total rounds: ${results.length}`);
    console.log(`Total tool calls: ${results.reduce((s, r) => s + r.tools, 0)}`);
    console.log();
    for (const r of results) {
      console.log(`  ${r.tag.padEnd(30)} tools:${String(r.tools).padStart(3)}  chars:${String(r.responseLen).padStart(6)}  ${r.stopReason}`);
    }
    console.log(green("═".repeat(60)));

  } catch (e: any) {
    console.error(red(`\nFatal: ${e?.message || JSON.stringify(e)}`));
  } finally {
    client.kill();
  }
}

main();
