#!/usr/bin/env bun
/**
 * cursor-acp-driver.ts
 *
 * Drives Cursor Agent over ACP (Agent Client Protocol) as a persistent
 * multi-turn session. You are the "human" — type prompts, cursor agent
 * executes them with full tool access.
 *
 * Usage:
 *   bun tools/cursor-acp-driver.ts                    # interactive REPL
 *   bun tools/cursor-acp-driver.ts --auto-approve     # auto-approve all permissions
 *   bun tools/cursor-acp-driver.ts --cwd /some/path   # set workspace
 *   bun tools/cursor-acp-driver.ts --model sonnet-4   # pick model
 */

import { spawn, type Subprocess } from "bun";
import * as readline from "node:readline";

// ── Config ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const AUTO_APPROVE = args.includes("--auto-approve");
const cwdIdx = args.indexOf("--cwd");
const CWD = cwdIdx !== -1 ? args[cwdIdx + 1] : process.cwd();
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

// ── Types ───────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── Color helpers ───────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ── JSON-RPC transport over stdio ───────────────────────────────────

class AcpTransport {
  private proc: Subprocess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private onNotification: (method: string, params: Record<string, unknown>) => void;
  private onRequest: (id: number, method: string, params: Record<string, unknown>) => void;
  private lineBuffer = "";

  constructor(opts: {
    onNotification: (method: string, params: Record<string, unknown>) => void;
    onRequest: (id: number, method: string, params: Record<string, unknown>) => void;
  }) {
    this.onNotification = opts.onNotification;
    this.onRequest = opts.onRequest;

    const agentArgs = ["agent", "acp"];
    // Pass API key if available
    if (process.env.CURSOR_API_KEY) {
      agentArgs.splice(1, 0, "--api-key", process.env.CURSOR_API_KEY);
    }

    this.proc = spawn({
      cmd: ["cursor", ...agentArgs],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read stdout line by line (NDJSON)
    this.readStream();
    // Pipe stderr to our stderr
    this.readStderr();
  }

  private async readStream() {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.lineBuffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = this.lineBuffer.indexOf("\n")) !== -1) {
          const line = this.lineBuffer.slice(0, newlineIdx).trim();
          this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch (e) {
      // Process ended
    }
  }

  private async readStderr() {
    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          process.stderr.write(dim(`[agent stderr] ${text}`));
        }
      }
    } catch {
      // Process ended
    }
  }

  private handleLine(line: string) {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(dim(`[unparseable] ${line}\n`));
      return;
    }

    // Response to our request
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const waiter = this.pending.get(msg.id as number);
      if (waiter) {
        this.pending.delete(msg.id as number);
        if ((msg as JsonRpcResponse).error) {
          waiter.reject((msg as JsonRpcResponse).error);
        } else {
          waiter.resolve((msg as JsonRpcResponse).result);
        }
      }
      return;
    }

    // Request from agent (needs response) — has id + method
    if ("id" in msg && "method" in msg) {
      this.onRequest(
        msg.id as number,
        (msg as JsonRpcRequest).method,
        ((msg as JsonRpcRequest).params ?? {}) as Record<string, unknown>,
      );
      return;
    }

    // Notification from agent
    if ("method" in msg && !("id" in msg)) {
      this.onNotification(
        (msg as JsonRpcNotification).method,
        ((msg as JsonRpcNotification).params ?? {}) as Record<string, unknown>,
      );
      return;
    }
  }

  send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.proc.stdin.write(msg + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  respond(id: number, result: unknown) {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    this.proc.stdin.write(msg + "\n");
  }

  notify(method: string, params: Record<string, unknown>) {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(msg + "\n");
  }

  kill() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      // already dead
    }
  }
}

// ── Main driver ─────────────────────────────────────────────────────

async function main() {
  console.log(bold("\n🔌 Cursor ACP Driver"));
  console.log(dim(`   workspace: ${CWD}`));
  console.log(dim(`   auto-approve: ${AUTO_APPROVE}`));
  if (MODEL) console.log(dim(`   model: ${MODEL}`));
  console.log();

  let sessionId: string | null = null;

  const transport = new AcpTransport({
    onNotification(method, params) {
      if (method === "session/update") {
        const update = (params as any).update;
        if (!update) return;

        switch (update.sessionUpdate) {
          case "agent_message_chunk":
            if (update.content?.text) {
              process.stdout.write(update.content.text);
            }
            break;

          case "agent_thought_chunk":
            if (update.content?.text) {
              process.stdout.write(dim(update.content.text));
            }
            break;

          case "tool_call":
            console.log(
              `\n${yellow("⚡")} ${bold(update.title || "tool call")} ${dim(`[${update.kind || "unknown"}]`)}`,
            );
            if (update.locations?.length) {
              for (const loc of update.locations) {
                console.log(dim(`   ${loc.path || JSON.stringify(loc)}`));
              }
            }
            break;

          case "tool_call_update":
            if (update.status === "completed") {
              console.log(dim(`   ✓ ${update.toolCallId} completed`));
            } else if (update.status === "error") {
              console.log(red(`   ✗ ${update.toolCallId} failed`));
            }
            break;

          case "plan":
            if (update.entries?.length) {
              console.log(`\n${magenta("📋 Plan:")}`);
              for (const entry of update.entries) {
                const icon = entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○";
                console.log(`   ${icon} ${entry.content}`);
              }
            }
            break;

          default:
            // Log unknown update types for debugging
            process.stderr.write(dim(`[update:${update.sessionUpdate}]\n`));
        }
      }
    },

    onRequest(id, method, params) {
      if (method === "session/request_permission") {
        const toolCall = (params as any).toolCall;
        const options = (params as any).options ?? [];

        console.log(`\n${yellow("🔒 Permission requested:")}`);
        console.log(`   ${bold(toolCall?.title || "unknown action")} ${dim(`[${toolCall?.kind || "?"}]`)}`);
        if (toolCall?.locations?.length) {
          for (const loc of toolCall.locations) {
            console.log(dim(`   ${loc.path || JSON.stringify(loc)}`));
          }
        }

        if (AUTO_APPROVE) {
          const allowOnce = options.find((o: any) => o.kind === "allow_once");
          const optionId = allowOnce?.optionId || options[0]?.optionId || "allow-once";
          console.log(green(`   → auto-approved (${optionId})`));
          transport.respond(id, { outcome: { outcome: "selected", optionId } });
          return;
        }

        // Interactive: ask user
        console.log(`   Options:`);
        options.forEach((opt: any, i: number) => {
          console.log(`     ${cyan(`[${i + 1}]`)} ${opt.name} ${dim(`(${opt.kind})`)}`);
        });

        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl2.question(`   ${cyan("Choice [1]:")} `, (answer) => {
          rl2.close();
          const idx = Math.max(0, (parseInt(answer) || 1) - 1);
          const chosen = options[idx] || options[0];
          if (chosen) {
            console.log(green(`   → ${chosen.name}`));
            transport.respond(id, { outcome: { outcome: "selected", optionId: chosen.optionId } });
          }
        });
        return;
      }

      // Handle filesystem callbacks from agent
      if (method === "fs/read_text_file") {
        const path = (params as any).path;
        try {
          const content = require("fs").readFileSync(path, "utf-8");
          transport.respond(id, { content });
        } catch (e: any) {
          transport.respond(id, { content: `[error reading ${path}: ${e.message}]` });
        }
        return;
      }

      if (method === "fs/write_text_file") {
        const path = (params as any).path;
        const contents = (params as any).contents;
        try {
          require("fs").writeFileSync(path, contents);
          transport.respond(id, {});
          console.log(green(`   ✓ wrote ${path}`));
        } catch (e: any) {
          console.log(red(`   ✗ failed to write ${path}: ${e.message}`));
          transport.respond(id, {});
        }
        return;
      }

      // Cursor-specific extensions
      if (method === "cursor/ask_question") {
        console.log(`\n${cyan("❓ Agent asks:")} ${(params as any).question || JSON.stringify(params)}`);
        const options = (params as any).options ?? [];
        if (options.length) {
          options.forEach((opt: any, i: number) => {
            console.log(`   ${cyan(`[${i + 1}]`)} ${opt.label || opt}`);
          });
        }
        // Default: pick first option
        const chosen = options[0];
        transport.respond(id, { selectedIndex: 0, selectedOption: chosen });
        return;
      }

      // Unknown request — log and respond with empty result
      console.log(dim(`[unhandled request: ${method}] ${JSON.stringify(params).slice(0, 200)}`));
      transport.respond(id, {});
    },
  });

  // ── Step 1: Initialize ──────────────────────────────────────────
  console.log(dim("Initializing ACP connection..."));
  const initResult = (await transport.send("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
    clientInfo: {
      name: "cursor-acp-driver",
      version: "0.1.0",
    },
  })) as any;

  console.log(
    dim(
      `Connected to ${initResult?.agentInfo?.name || "agent"} v${initResult?.agentInfo?.version || "?"}` +
        ` (protocol v${initResult?.protocolVersion || "?"})`,
    ),
  );

  // ── Step 2: Authenticate ────────────────────────────────────────
  console.log(dim("Authenticating..."));
  try {
    await transport.send("authenticate", { methodId: "cursor_login" });
    console.log(green("Authenticated ✓"));
  } catch (e: any) {
    // May already be authenticated via env var or prior login
    console.log(yellow(`Auth note: ${e?.message || JSON.stringify(e)}`));
  }

  // ── Step 3: Create session ──────────────────────────────────────
  console.log(dim("Creating session..."));
  const sessionResult = (await transport.send("session/new", {
    cwd: CWD,
    mcpServers: [],
  })) as any;

  sessionId = sessionResult?.sessionId;
  const currentModel = sessionResult?.models?.currentModelId || "unknown";
  const availableModels = (sessionResult?.models?.availableModels ?? []) as { modelId: string; name: string }[];
  const currentMode = sessionResult?.modes?.currentModeId || "agent";

  console.log(green(`Session created: ${sessionId}`));
  console.log(dim(`   mode: ${currentMode} | model: ${currentModel}`));

  // If --model was passed, switch to it
  if (MODEL && sessionId) {
    const match = availableModels.find(
      (m) => m.modelId.includes(MODEL!) || m.name.toLowerCase().includes(MODEL!.toLowerCase()),
    );
    if (match) {
      try {
        await transport.send("session/set_config", { sessionId, configId: "model", value: match.modelId });
        console.log(green(`   switched model → ${match.name} (${match.modelId})`));
      } catch (e: any) {
        console.log(yellow(`   model switch failed: ${e?.message || JSON.stringify(e)}`));
      }
    } else {
      console.log(yellow(`   model "${MODEL}" not found. Available:`));
      for (const m of availableModels) {
        console.log(dim(`     ${m.name} → ${m.modelId}`));
      }
    }
  }
  console.log();

  // ── Step 4: Interactive REPL ────────────────────────────────────
  console.log(bold("Ready. Type your prompts below."));
  console.log(dim("Commands: /quit, /cancel, /mode <agent|plan|ask>, /model <name>, /models, /session"));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan("\nyou → "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Meta commands
    if (input === "/quit" || input === "/exit") {
      console.log(dim("Shutting down..."));
      transport.kill();
      process.exit(0);
    }

    if (input === "/cancel") {
      if (sessionId) {
        transport.notify("session/cancel", { sessionId });
        console.log(yellow("Cancelled current operation."));
      }
      rl.prompt();
      return;
    }

    if (input.startsWith("/mode ")) {
      const mode = input.slice(6).trim();
      if (sessionId && ["agent", "plan", "ask"].includes(mode)) {
        try {
          await transport.send("session/set_mode", { sessionId, mode });
          console.log(green(`Mode set to: ${mode}`));
        } catch (e: any) {
          console.log(red(`Failed to set mode: ${e?.message || JSON.stringify(e)}`));
        }
      }
      rl.prompt();
      return;
    }

    if (input === "/models") {
      console.log(bold("Available models:"));
      for (const m of availableModels) {
        console.log(`   ${m.name} ${dim(`→ ${m.modelId}`)}`);
      }
      rl.prompt();
      return;
    }

    if (input.startsWith("/model ")) {
      const query = input.slice(7).trim();
      const match = availableModels.find(
        (m) => m.modelId.includes(query) || m.name.toLowerCase().includes(query.toLowerCase()),
      );
      if (match && sessionId) {
        try {
          await transport.send("session/set_config", { sessionId, configId: "model", value: match.modelId });
          console.log(green(`Model → ${match.name} (${match.modelId})`));
        } catch (e: any) {
          console.log(red(`Failed: ${e?.message || JSON.stringify(e)}`));
        }
      } else {
        console.log(red(`No model matching "${query}". Use /models to list.`));
      }
      rl.prompt();
      return;
    }

    if (input === "/session") {
      console.log(dim(`Session ID: ${sessionId}`));
      rl.prompt();
      return;
    }

    if (!sessionId) {
      console.log(red("No active session."));
      rl.prompt();
      return;
    }

    // Send prompt to agent
    console.log(); // blank line before response
    try {
      const result = (await transport.send("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: input }],
      })) as any;

      console.log(dim(`\n[stop: ${result?.stopReason || "unknown"}]`));
    } catch (e: any) {
      console.log(red(`\nError: ${e?.message || JSON.stringify(e)}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    transport.kill();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(red(`Fatal: ${e.message || e}`));
  process.exit(1);
});
