#!/usr/bin/env bun
/**
 * cursor-acp-session.ts
 *
 * Claude Code drives Cursor Agent over ACP to:
 * 1. Read the cursor adapter and understand its gaps
 * 2. Identify edge cases in blob parsing, meta decoding, etc.
 * 3. Write comprehensive tests for src/adapters/cursor.ts
 * 4. Find bugs and issues
 *
 * Usage:
 *   bun tools/cursor-acp-session.ts
 */

import { spawn } from "bun";

// ── ACP Transport (reused from cursor-acp-driver.ts) ────────────────

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

class AcpClient {
  private proc;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private lineBuffer = "";
  private messageLog: string[] = [];
  private toolCalls: { title: string; kind: string; status: string }[] = [];

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
          if (line) this.handleLine(line);
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
        const text = dec.decode(value, { stream: true });
        if (text.includes("error") || text.includes("Error")) {
          process.stderr.write(red(`[stderr] ${text}`));
        }
      }
    } catch {}
  }

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Response to our request
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const w = this.pending.get(msg.id);
      if (w) {
        this.pending.delete(msg.id);
        msg.error ? w.reject(msg.error) : w.resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg.method === "session/update") {
      const u = msg.params?.update;
      if (!u) return;

      switch (u.sessionUpdate) {
        case "agent_message_chunk":
          if (u.content?.text) {
            process.stdout.write(u.content.text);
            this.messageLog.push(u.content.text);
          }
          break;
        case "agent_thought_chunk":
          if (u.content?.text) {
            process.stdout.write(dim(u.content.text));
          }
          break;
        case "tool_call":
          console.log(`\n${yellow("⚡")} ${bold(u.title || "tool")} ${dim(`[${u.kind}]`)}`);
          if (u.locations?.length) {
            for (const loc of u.locations) console.log(dim(`   ${loc.path || JSON.stringify(loc)}`));
          }
          this.toolCalls.push({ title: u.title || "", kind: u.kind || "", status: "pending" });
          break;
        case "tool_call_update":
          if (u.status === "completed") console.log(dim(`   ✓ done`));
          break;
      }
      return;
    }

    // Request from agent — auto-approve everything
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
        } catch (e: any) {
          this.respond(msg.id, {});
        }
      } else {
        this.respond(msg.id, {});
      }
      return;
    }
  }

  private send(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private respond(id: number, result: unknown) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  async initialize(): Promise<string> {
    console.log(dim("Initializing ACP..."));
    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: "claude-code-driver", version: "0.1.0" },
    });

    console.log(dim("Authenticating..."));
    await this.send("authenticate", { methodId: "cursor_login" });

    console.log(dim("Creating session..."));
    const sess = await this.send("session/new", {
      cwd: "/Users/edenmendel/Documents/GitHub/jin",
      mcpServers: [],
    });

    console.log(green(`Session: ${sess.sessionId}`));
    return sess.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string; response: string }> {
    this.messageLog = [];
    this.toolCalls = [];

    console.log(`\n${cyan("━".repeat(60))}`);
    console.log(`${cyan("PROMPT:")} ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);
    console.log(`${cyan("━".repeat(60))}\n`);

    const result = await this.send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });

    const response = this.messageLog.join("");
    console.log(dim(`\n[stop: ${result?.stopReason}] [tools: ${this.toolCalls.length}]`));
    return { stopReason: result?.stopReason || "unknown", response };
  }

  kill() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {}
  }
}

// ── Session orchestration ───────────────────────────────────────────

async function runSession() {
  const client = new AcpClient();

  try {
    const sessionId = await client.initialize();

    // ── Turn 1: Read and understand the adapter ──────────────────
    await client.prompt(sessionId, `You are helping audit and test the Cursor adapter for the "jin" project. Jin tracks AI coding conversations across tools (Claude Code, Cursor, Copilot, etc).

Read these files carefully:
1. src/adapters/cursor.ts — the current adapter implementation (reads Layer 3 store.db only)
2. src/adapters/types.ts — the Adapter, Session, Message, ToolUse interfaces
3. docs/adapters/cursor/overview.md — the full storage architecture we discovered (4 layers)
4. docs/adapters/cursor/examples.md — real data samples

After reading, give me a concise summary of:
- What the adapter currently does vs what it should do
- The most critical gaps/bugs you see
- What the blob parsing misses`);

    // ── Turn 2: Identify edge cases ──────────────────────────────
    await client.prompt(sessionId, `Now look more closely at the adapter code. I want you to enumerate specific edge cases and potential bugs. Focus on:

1. **Meta decoding**: What happens when hex decoding fails? When createdAt is missing? When agentId is missing?
2. **Blob traversal**: What if there's a cycle in parentId references? What about very deep chains (stack overflow)? What if latestRootBlobId points to a non-existent blob?
3. **Content extraction**: The collectMessages() joins content with \\n — what about tool-call and tool-result blocks? What about reasoning blocks?
4. **Concurrency**: Cursor IDE may have the database locked — is WAL mode handled?
5. **Empty/corrupt state**: Empty blobs table, empty meta table, null data in blobs, truncated hex in meta

Also read the existing test files to see what's already tested:
- Look at test/*.test.ts files, especially any that test adapters

List every edge case as a numbered list. Be thorough.`);

    // ── Turn 3: Write the tests ──────────────────────────────────
    await client.prompt(sessionId, `Now write a comprehensive test file at test/cursor-adapter.test.ts using Bun's test runner.

Structure the tests in these groups:

1. **readSessionMeta()** — test hex decoding, missing fields, corrupt hex, non-JSON hex, missing meta row
2. **collectMessages() / readMessages()** — test blob chain traversal, protobuf blobs (should be skipped gracefully), JSON blobs with different roles, content extraction from arrays, cycle detection, deep chains, missing blobs in chain
3. **sessions()** — test directory enumeration, missing directories, empty workspaces, name fallback logic
4. **messages()** — test end-to-end with mock store.db, verify timestamp interpolation
5. **detect()** — test with/without chats dir, with/without store.db files

Important implementation notes:
- Use Bun's test runner: import { describe, it, expect, beforeEach, afterEach } from "bun:test"
- Create temporary directories with real SQLite databases (use bun:sqlite Database class) for fixtures
- Don't mock the Database class — create real SQLite files in a temp dir
- Clean up temp dirs in afterEach
- The adapter constructor hardcodes chatsDir to ~/.cursor/chats — you'll need to either:
  a) Create a test subclass that overrides the path, or
  b) Use a factory pattern, or
  c) Set up the temp dir at the exact path structure the adapter expects
  The cleanest approach is probably (a): create a TestCursorAdapter class that extends CursorAdapter with a custom chatsDir.

Actually, looking at cursor.ts more carefully, chatsDir is private with no setter. So the test will need to either:
- Patch it via Object.defineProperty or (adapter as any).chatsDir = ...
- Or create test store.db files in a temp dir and call the private methods directly

Use whatever approach is cleanest. The goal is thorough coverage.

Write the FULL test file — don't abbreviate or use "..." placeholders.`);

    // ── Turn 4: Review and find issues ───────────────────────────
    await client.prompt(sessionId, `Now read the test file you just wrote at test/cursor-adapter.test.ts. Also re-read src/adapters/cursor.ts.

Look for:
1. Did we miss any edge cases? If so, add them.
2. Are there any actual bugs in cursor.ts that the tests would reveal? If you find bugs, list them clearly.
3. Check: does the adapter correctly handle the case where a blob's data is a Buffer vs a Uint8Array vs a string? Bun:sqlite returns Buffer by default for BLOB columns.
4. Does the adapter ever close the database on error paths? Check for resource leaks.
5. The adapter maps role "tool" to "assistant" — is that correct per the types.ts interface?

Give me a clear list of bugs found, then update the test file if any tests are missing.`);

    // ── Turn 5: Final summary ────────────────────────────────────
    const final = await client.prompt(sessionId, `Give me a final summary:

1. **Files created/modified**: List every file you touched
2. **Bugs found**: Clear numbered list of bugs in cursor.ts with severity
3. **Test coverage**: What does the test file cover? How many tests?
4. **Recommended next steps**: What should be done to improve the adapter?

Keep it concise — this is the report I'll review.`);

    console.log(`\n\n${green("═".repeat(60))}`);
    console.log(green("SESSION COMPLETE"));
    console.log(green("═".repeat(60)));

  } catch (e: any) {
    console.error(red(`\nFatal: ${e?.message || JSON.stringify(e)}`));
  } finally {
    client.kill();
  }
}

runSession();
