import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing";
import type { Adapter, Session, Message, ToolUse, ThinkingBlock } from "./types";

// Codex JSONL record types
interface RawRecord {
  type: string;
  timestamp?: string;
  session_id?: string;
  // message types
  role?: string;
  content?: unknown;
  model?: string;
  // function_call / tool types
  name?: string;
  id?: string;
  call_id?: string;
  output?: string;
  arguments?: string;
  // usage
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  // thinking
  thinking?: string;
  summary?: string;
  // session_meta
  cwd?: string;
}

export class CodexAdapter implements Adapter {
  id = "codex";
  name = "Codex";
  icon = "▶";
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = join(homedir(), ".codex", "sessions");
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.sessionsDir)) return false;
    const files = readdirSync(this.sessionsDir);
    return files.some((f) => f.endsWith(".jsonl"));
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const sessions: Session[] = [];

    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(this.sessionsDir, file);
      try {
        const meta = await this.parseSessionMeta(filePath);
        if (!meta || meta.msgCount === 0) continue;
        const stat = statSync(filePath);

        sessions.push({
          id: meta.sessionId,
          name: meta.name || meta.sessionId.slice(0, 8),
          adapterId: this.id,
          adapterName: this.name,
          createdAt: meta.firstMsg,
          updatedAt: meta.lastMsg,
          durationMs: new Date(meta.lastMsg).getTime() - new Date(meta.firstMsg).getTime(),
          isActive: Date.now() - new Date(meta.lastMsg).getTime() < 5 * 60 * 1000,
          totalTokens: meta.totalTokens,
          estCost: meta.estCost,
          messageCount: meta.msgCount,
          sourcePath: filePath,
          isSubAgent: false,
          metadata: { cwd: meta.cwd, fileSize: stat.size },
        });
      } catch { continue; }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = this.findSessionFile(sessionId);
    if (!filePath) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    return existsSync(this.sessionsDir) ? [this.sessionsDir] : [];
  }

  private findSessionFile(sessionId: string): string | null {
    if (!existsSync(this.sessionsDir)) return null;
    // Session ID may be in the filename or within the file
    const direct = join(this.sessionsDir, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;

    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      if (file.includes(sessionId)) return join(this.sessionsDir, file);
    }
    return null;
  }

  private async parseSessionMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);

    let sessionId = basename(filePath, ".jsonl");
    let cwd = "";
    let firstMsg = "";
    let lastMsg = "";
    let msgCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let firstUserMessage = "";
    let primaryModel = "";

    for (const line of lines) {
      try {
        const rec: RawRecord = JSON.parse(line);
        if (rec.session_id && !sessionId) sessionId = rec.session_id;
        if (rec.cwd && rec.type === "session_meta") cwd = rec.cwd;
        if (rec.timestamp) {
          if (!firstMsg) firstMsg = rec.timestamp;
          lastMsg = rec.timestamp;
        }

        if (rec.type === "message" && rec.role) {
          msgCount++;
          if (rec.role === "user" && !firstUserMessage && rec.content) {
            firstUserMessage = typeof rec.content === "string"
              ? rec.content.slice(0, 120)
              : "";
          }
          if (rec.model && !primaryModel) primaryModel = rec.model;
        }

        if (rec.usage) {
          totalInput += rec.usage.input_tokens || 0;
          totalOutput += rec.usage.output_tokens || 0;
        }
      } catch { continue; }
    }

    const name = firstUserMessage.replace(/\n/g, " ").slice(0, 120) || sessionId.slice(0, 8);
    const estCost = estimateCost(primaryModel, totalInput, totalOutput);

    return {
      sessionId,
      name,
      cwd,
      firstMsg: firstMsg || new Date().toISOString(),
      lastMsg: lastMsg || new Date().toISOString(),
      msgCount,
      totalTokens: totalInput + totalOutput,
      estCost,
    };
  }

  private async parseMessages(filePath: string): Promise<Message[]> {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    const messages: Message[] = [];
    const toolIndex = new Map<string, { msgIdx: number; toolIdx: number }>();

    let pendingTools: ToolUse[] = [];
    let pendingThinking: ThinkingBlock[] = [];
    let currentModel = "";
    let lastTimestamp = "";

    for (const line of lines) {
      try {
        const rec: RawRecord = JSON.parse(line);
        if (rec.timestamp) lastTimestamp = rec.timestamp;
        if (rec.model) currentModel = rec.model;

        switch (rec.type) {
          case "message":
            if (rec.role === "user") {
              // Flush pending
              if (pendingTools.length > 0 || pendingThinking.length > 0) {
                messages.push({
                  id: `synth-${messages.length}`,
                  role: "assistant",
                  content: "tool calls",
                  timestamp: lastTimestamp,
                  model: currentModel,
                  inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
                  toolUses: [...pendingTools],
                  thinkingBlocks: [...pendingThinking],
                });
                pendingTools = [];
                pendingThinking = [];
              }
              messages.push({
                id: rec.id || `msg-${messages.length}`,
                role: "user",
                content: typeof rec.content === "string" ? rec.content : JSON.stringify(rec.content),
                timestamp: lastTimestamp,
                model: "",
                inputTokens: rec.usage?.input_tokens || 0,
                outputTokens: 0, cacheRead: 0, cacheWrite: 0,
                toolUses: [], thinkingBlocks: [],
              });
            } else if (rec.role === "assistant") {
              const content = typeof rec.content === "string" ? rec.content : "";
              if (content) {
                messages.push({
                  id: rec.id || `msg-${messages.length}`,
                  role: "assistant",
                  content,
                  timestamp: lastTimestamp,
                  model: currentModel,
                  inputTokens: rec.usage?.input_tokens || 0,
                  outputTokens: rec.usage?.output_tokens || 0,
                  cacheRead: 0, cacheWrite: 0,
                  toolUses: [...pendingTools],
                  thinkingBlocks: [...pendingThinking],
                });
                pendingTools = [];
                pendingThinking = [];
              }
            }
            break;

          case "function_call":
            const tool: ToolUse = {
              id: rec.call_id || rec.id || "",
              name: rec.name || "",
              input: rec.arguments || "",
              output: "",
            };
            pendingTools.push(tool);
            if (tool.id) {
              toolIndex.set(tool.id, { msgIdx: -1, toolIdx: pendingTools.length - 1 });
            }
            break;

          case "function_call_output":
            if (rec.call_id && toolIndex.has(rec.call_id)) {
              const ref = toolIndex.get(rec.call_id)!;
              if (ref.msgIdx === -1) {
                // Still in pending
                pendingTools[ref.toolIdx].output = rec.output || "";
              }
            }
            break;

          case "reasoning":
            if (rec.thinking || rec.summary) {
              pendingThinking.push({
                content: rec.thinking || rec.summary || "",
                tokenCount: Math.ceil((rec.thinking || rec.summary || "").length / 4),
              });
            }
            break;
        }
      } catch { continue; }
    }

    // Flush remaining
    if (pendingTools.length > 0 || pendingThinking.length > 0) {
      messages.push({
        id: `synth-${messages.length}`,
        role: "assistant",
        content: "tool calls",
        timestamp: lastTimestamp,
        model: currentModel,
        inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
        toolUses: pendingTools,
        thinkingBlocks: pendingThinking,
      });
    }

    return messages;
  }
}
