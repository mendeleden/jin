import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir, platform } from "os";
import type { Adapter, Session, Message, ToolUse } from "./types";

function findThreadsDir(): string {
  const home = homedir();
  if (process.env.AMP_DATA_HOME) {
    return join(process.env.AMP_DATA_HOME, "amp", "threads");
  }
  if (platform() === "linux") {
    const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share");
    return join(xdgData, "amp", "threads");
  }
  return join(home, ".local", "share", "amp", "threads");
}

export class AmpAdapter implements Adapter {
  id = "amp";
  name = "Amp Code";
  icon = "⚡";
  private threadsDir: string;

  constructor() {
    this.threadsDir = findThreadsDir();
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.threadsDir)) return false;
    return readdirSync(this.threadsDir).some((f) => f.endsWith(".jsonl"));
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.threadsDir)) return [];
    const sessions: Session[] = [];

    for (const file of readdirSync(this.threadsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(this.threadsDir, file);
      try {
        const meta = await this.parseMeta(filePath);
        if (!meta || meta.msgCount === 0) continue;
        const stat = statSync(filePath);

        sessions.push({
          id: meta.id,
          name: meta.name || meta.id.slice(0, 8),
          adapterId: this.id,
          adapterName: this.name,
          createdAt: meta.firstMsg,
          updatedAt: meta.lastMsg,
          durationMs: new Date(meta.lastMsg).getTime() - new Date(meta.firstMsg).getTime(),
          isActive: Date.now() - new Date(meta.lastMsg).getTime() < 5 * 60 * 1000,
          totalTokens: 0,
          estCost: 0,
          messageCount: meta.msgCount,
          sourcePath: filePath,
          isSubAgent: false,
          metadata: { fileSize: stat.size },
        });
      } catch { continue; }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = this.findFile(sessionId);
    if (!filePath) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    return existsSync(this.threadsDir) ? [this.threadsDir] : [];
  }

  private findFile(sessionId: string): string | null {
    if (!existsSync(this.threadsDir)) return null;
    for (const file of readdirSync(this.threadsDir)) {
      if (file.includes(sessionId)) return join(this.threadsDir, file);
    }
    return null;
  }

  private async parseMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    let id = basename(filePath, ".jsonl");
    let firstMsg = "";
    let lastMsg = "";
    let msgCount = 0;
    let firstUserMessage = "";

    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.timestamp) {
          if (!firstMsg) firstMsg = rec.timestamp;
          lastMsg = rec.timestamp;
        }
        if (rec.role === "user" || rec.role === "assistant") {
          msgCount++;
          if (rec.role === "user" && !firstUserMessage) {
            firstUserMessage = (typeof rec.content === "string" ? rec.content : "").slice(0, 120);
          }
        }
        if (rec.thread_id || rec.id) id = rec.thread_id || rec.id;
      } catch { continue; }
    }

    return {
      id,
      name: firstUserMessage.replace(/\n/g, " ") || id.slice(0, 8),
      firstMsg: firstMsg || new Date().toISOString(),
      lastMsg: lastMsg || new Date().toISOString(),
      msgCount,
    };
  }

  private async parseMessages(filePath: string): Promise<Message[]> {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    const messages: Message[] = [];

    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.role !== "user" && rec.role !== "assistant") continue;

        const content = typeof rec.content === "string"
          ? rec.content
          : Array.isArray(rec.content)
            ? rec.content.map((b: any) => b.text || "").join("\n")
            : "";

        messages.push({
          id: rec.id || `amp-${messages.length}`,
          role: rec.role,
          content,
          timestamp: rec.timestamp || "",
          model: rec.model || "",
          inputTokens: rec.usage?.input_tokens || 0,
          outputTokens: rec.usage?.output_tokens || 0,
          cacheRead: 0, cacheWrite: 0,
          toolUses: (rec.tool_calls || []).map((tc: any) => ({
            id: tc.id || "",
            name: tc.function?.name || tc.name || "",
            input: tc.function?.arguments || tc.input || "",
            output: "",
          })),
          thinkingBlocks: [],
        });
      } catch { continue; }
    }
    return messages;
  }
}
