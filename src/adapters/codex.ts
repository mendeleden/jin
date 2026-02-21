import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing";
import type { Adapter, Session, Message, ToolUse, ThinkingBlock } from "./types";

const HOME = homedir();
const CODEX_HOME = process.env.CODEX_HOME || join(HOME, ".codex");

// Codex JSONL record types — supports both old bare format and new RolloutLine envelope
interface RawRecord {
  type: string;
  payload?: any;  // RolloutLine envelope
  timestamp?: string;
  session_id?: string;
  role?: string;
  content?: unknown;
  model?: string;
  name?: string;
  id?: string;
  call_id?: string;
  output?: string;
  arguments?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cached_input_tokens?: number };
  thinking?: string;
  summary?: string;
  cwd?: string;
}

/** Unwrap RolloutLine envelope if present */
function unwrapRecord(raw: RawRecord): RawRecord {
  if (raw.payload && typeof raw.payload === "object") {
    return { type: raw.type, ...raw.payload };
  }
  return raw;
}

export class CodexAdapter implements Adapter {
  id = "codex";
  name = "Codex";
  icon = "▶";
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = join(CODEX_HOME, "sessions");
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.sessionsDir)) return false;
    return this.findAllSessionFiles().length > 0;
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const sessions: Session[] = [];

    for (const filePath of this.findAllSessionFiles()) {
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
          parentSessionId: "",
          isCompacted: meta.isCompacted,
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

  /** Recursively find all JSONL session files (flat or date-partitioned YYYY/MM/DD/) */
  private findAllSessionFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 4) return; // YYYY/MM/DD = 3 levels max
      if (!existsSync(dir)) return;
      try {
        for (const entry of readdirSync(dir)) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && entry.endsWith(".jsonl")) {
              files.push(fullPath);
            } else if (stat.isDirectory()) {
              walk(fullPath, depth + 1);
            }
          } catch { continue; }
        }
      } catch { /* skip unreadable dirs */ }
    };
    walk(this.sessionsDir, 0);
    return files;
  }

  private findSessionFile(sessionId: string): string | null {
    if (!existsSync(this.sessionsDir)) return null;
    // Direct path (flat layout)
    const direct = join(this.sessionsDir, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;

    // Search all session files (handles date-partitioned layout)
    for (const filePath of this.findAllSessionFiles()) {
      const name = basename(filePath, ".jsonl");
      if (name === sessionId || name.includes(sessionId) || filePath.includes(sessionId)) {
        return filePath;
      }
    }
    return null;
  }

  private async parseSessionMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);

    // Extract thread ID from rollout-<thread_id>.jsonl filename pattern
    const fileName = basename(filePath, ".jsonl");
    let sessionId = fileName.startsWith("rollout-") ? fileName.slice(8) : fileName;
    let cwd = "";
    let firstMsg = "";
    let lastMsg = "";
    let msgCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let firstUserMessage = "";
    let primaryModel = "";
    let isCompacted = false;

    for (const line of lines) {
      try {
        const raw: RawRecord = JSON.parse(line);
        const rec = unwrapRecord(raw);

        if (rec.session_id) sessionId = rec.session_id;
        if (rec.cwd && (rec.type === "session_meta" || rec.type === "config_snapshot")) cwd = rec.cwd;
        if (rec.timestamp) {
          if (!firstMsg) firstMsg = rec.timestamp;
          lastMsg = rec.timestamp;
        }

        // Detect compaction events
        if (rec.type === "compaction" || rec.type === "rollout_compaction") {
          isCompacted = true;
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
          totalCached += rec.usage.cached_input_tokens || 0;
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
      isCompacted,
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
        const raw: RawRecord = JSON.parse(line);
        const rec = unwrapRecord(raw);
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
                  recordType: "message",
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
                recordType: "message",
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
                  cacheRead: rec.usage?.cached_input_tokens || 0,
                  cacheWrite: 0,
                  toolUses: [...pendingTools],
                  thinkingBlocks: [...pendingThinking],
                  recordType: "message",
                });
                pendingTools = [];
                pendingThinking = [];
              }
            }
            break;

          case "function_call": {
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
          }

          case "function_call_output":
            if (rec.call_id && toolIndex.has(rec.call_id)) {
              const ref = toolIndex.get(rec.call_id)!;
              if (ref.msgIdx === -1) {
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

          case "compaction":
          case "rollout_compaction":
            // Record compaction as a system message
            messages.push({
              id: rec.id || `compact-${messages.length}`,
              role: "system",
              content: rec.summary || "compaction event",
              timestamp: lastTimestamp,
              model: "",
              inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
              toolUses: [], thinkingBlocks: [],
              recordType: "compaction",
            });
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
        recordType: "message",
      });
    }

    return messages;
  }
}
