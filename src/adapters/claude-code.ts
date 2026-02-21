import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing";
import type { Adapter, Session, Message, ToolUse, ThinkingBlock } from "./types";

// Claude Code JSONL schema
interface RawLine {
  type: string;
  uuid: string;
  sessionId?: string;
  timestamp: string;
  slug?: string;
  cwd?: string;
  message?: {
    role: string;
    content: unknown; // string | ContentBlock[]
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function findProjectsDir(): string {
  const home = homedir();
  // v1.0.30+ XDG path (preferred)
  const xdg = join(home, ".config", "claude", "projects");
  if (existsSync(xdg)) return xdg;
  // Legacy path
  const legacy = join(home, ".claude", "projects");
  if (existsSync(legacy)) return legacy;
  return xdg;
}

export class ClaudeCodeAdapter implements Adapter {
  id = "claude-code";
  name = "Claude Code";
  icon = "◆";
  private projectsDir: string;

  constructor() {
    this.projectsDir = findProjectsDir();
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.projectsDir)) return false;
    const entries = readdirSync(this.projectsDir);
    return entries.some((d) => {
      const sub = join(this.projectsDir, d);
      try {
        if (!statSync(sub).isDirectory()) return false;
        return readdirSync(sub).some((f) => f.endsWith(".jsonl"));
      } catch {
        return false;
      }
    });
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.projectsDir)) return [];
    const sessions: Session[] = [];

    for (const projDir of readdirSync(this.projectsDir)) {
      const dirPath = join(this.projectsDir, projDir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch {
        continue;
      }

      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(dirPath, file);
        try {
          const meta = await this.parseSessionMeta(filePath);
          if (!meta || meta.msgCount === 0) continue;

          const stat = statSync(filePath);
          const isSubAgent = file.startsWith("agent-");

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
            isSubAgent,
            metadata: { cwd: meta.cwd, slug: meta.slug, fileSize: stat.size },
          });
        } catch {
          continue;
        }
      }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = await this.findSessionFile(sessionId);
    if (!filePath) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    if (!existsSync(this.projectsDir)) return [];
    const paths: string[] = [];
    try {
      for (const d of readdirSync(this.projectsDir)) {
        const sub = join(this.projectsDir, d);
        if (existsSync(sub) && statSync(sub).isDirectory()) {
          paths.push(sub);
        }
      }
    } catch { /* ignore */ }
    return paths;
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    if (!existsSync(this.projectsDir)) return null;
    for (const projDir of readdirSync(this.projectsDir)) {
      const dirPath = join(this.projectsDir, projDir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        for (const file of readdirSync(dirPath)) {
          if (!file.endsWith(".jsonl")) continue;
          // Check if this file contains the session
          const filePath = join(dirPath, file);
          const firstLine = (await Bun.file(filePath).text()).split("\n")[0];
          if (!firstLine) continue;
          try {
            const parsed = JSON.parse(firstLine);
            if (parsed.sessionId === sessionId || parsed.uuid === sessionId) {
              return filePath;
            }
          } catch { continue; }
        }
      } catch { continue; }
    }
    return null;
  }

  private async parseSessionMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    let sessionId = "";
    let slug = "";
    let cwd = "";
    let firstMsg = "";
    let lastMsg = "";
    let msgCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let firstUserMessage = "";
    let primaryModel = "";

    for (const line of lines) {
      try {
        const raw: RawLine = JSON.parse(line);
        if (!sessionId && raw.sessionId) sessionId = raw.sessionId;
        if (!slug && raw.slug) slug = raw.slug;
        if (!cwd && raw.cwd) cwd = raw.cwd;

        if (raw.type === "user" || raw.type === "assistant") {
          if (!firstMsg) firstMsg = raw.timestamp;
          lastMsg = raw.timestamp;
          msgCount++;

          if (raw.type === "user" && !firstUserMessage && raw.message?.content) {
            const content = raw.message.content;
            if (typeof content === "string") {
              firstUserMessage = content.slice(0, 120);
            } else if (Array.isArray(content)) {
              const textBlock = (content as ContentBlock[]).find((b) => b.type === "text");
              if (textBlock?.text) firstUserMessage = textBlock.text.slice(0, 120);
            }
          }

          if (raw.message?.usage) {
            totalInputTokens += raw.message.usage.input_tokens || 0;
            totalOutputTokens += raw.message.usage.output_tokens || 0;
            totalCacheRead += raw.message.usage.cache_read_input_tokens || 0;
            totalCacheWrite += raw.message.usage.cache_creation_input_tokens || 0;
          }
          if (raw.message?.model && !primaryModel) {
            primaryModel = raw.message.model;
          }
        }
      } catch {
        continue;
      }
    }

    if (!sessionId) sessionId = basename(filePath, ".jsonl");

    // Clean XML tags from title
    let name = firstUserMessage.replace(/<[^>]+>/g, "").trim();
    // Truncate and clean
    if (name.length > 120) name = name.slice(0, 117) + "...";
    // Remove newlines
    name = name.replace(/\n/g, " ");

    const estCost = estimateCost(
      primaryModel,
      totalInputTokens,
      totalOutputTokens,
      totalCacheRead,
      totalCacheWrite
    );

    return {
      sessionId,
      name: name || slug || sessionId.slice(0, 8),
      slug,
      cwd,
      firstMsg: firstMsg || new Date().toISOString(),
      lastMsg: lastMsg || new Date().toISOString(),
      msgCount,
      totalTokens: totalInputTokens + totalOutputTokens,
      estCost,
    };
  }

  private async parseMessages(filePath: string): Promise<Message[]> {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    const messages: Message[] = [];
    const toolUseRefs = new Map<string, { msgIdx: number; toolIdx: number }>();

    for (const line of lines) {
      try {
        const raw: RawLine = JSON.parse(line);
        if (raw.type !== "user" && raw.type !== "assistant") continue;
        if (!raw.message) continue;

        const msg: Message = {
          id: raw.uuid,
          role: raw.message.role as "user" | "assistant",
          content: "",
          timestamp: raw.timestamp,
          model: raw.message.model || "",
          inputTokens: raw.message.usage?.input_tokens || 0,
          outputTokens: raw.message.usage?.output_tokens || 0,
          cacheRead: raw.message.usage?.cache_read_input_tokens || 0,
          cacheWrite: raw.message.usage?.cache_creation_input_tokens || 0,
          toolUses: [],
          thinkingBlocks: [],
        };

        const content = raw.message.content;
        if (typeof content === "string") {
          msg.content = content;
        } else if (Array.isArray(content)) {
          const blocks = content as ContentBlock[];
          const textParts: string[] = [];

          for (const block of blocks) {
            switch (block.type) {
              case "text":
                if (block.text) textParts.push(block.text);
                break;
              case "thinking":
                if (block.thinking) {
                  msg.thinkingBlocks.push({
                    content: block.thinking,
                    tokenCount: Math.ceil(block.thinking.length / 4),
                  });
                }
                break;
              case "tool_use":
                const toolUse: ToolUse = {
                  id: block.id || "",
                  name: block.name || "",
                  input: block.input ? JSON.stringify(block.input) : "",
                  output: "",
                };
                msg.toolUses.push(toolUse);
                if (block.id) {
                  toolUseRefs.set(block.id, {
                    msgIdx: messages.length,
                    toolIdx: msg.toolUses.length - 1,
                  });
                }
                break;
              case "tool_result":
                // Link result back to the tool_use
                if (block.tool_use_id && toolUseRefs.has(block.tool_use_id)) {
                  const ref = toolUseRefs.get(block.tool_use_id)!;
                  const targetMsg = messages[ref.msgIdx];
                  if (targetMsg && targetMsg.toolUses[ref.toolIdx]) {
                    let output = "";
                    if (typeof block.content === "string") {
                      output = block.content;
                    } else if (Array.isArray(block.content)) {
                      output = (block.content as any[])
                        .map((c) => c.text || JSON.stringify(c))
                        .join("\n");
                    }
                    targetMsg.toolUses[ref.toolIdx].output = output;
                  }
                }
                break;
            }
          }
          msg.content = textParts.join("\n\n");
        }

        messages.push(msg);
      } catch {
        continue;
      }
    }
    return messages;
  }
}
