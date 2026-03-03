import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { estimateCost } from "../pricing";
import type { Adapter, Session, Message, ToolUse, ThinkingBlock, ContextArtifact, ArtifactKind } from "./types";

// Claude Code JSONL schema
interface RawLine {
  type: string;
  subtype?: string;
  uuid: string;
  parentUuid?: string;
  sessionId?: string;
  timestamp: string;
  slug?: string;
  cwd?: string;
  summary?: string;
  customTitle?: string;
  leafUuid?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };
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

const HOME = homedir();

function findProjectsDir(): string {
  // v1.0.30+ XDG path (preferred)
  const xdg = join(HOME, ".config", "claude", "projects");
  if (existsSync(xdg)) return xdg;
  // Legacy path
  const legacy = join(HOME, ".claude", "projects");
  if (existsSync(legacy)) return legacy;
  return xdg;
}

function findClaudeDir(): string {
  return join(HOME, ".claude");
}

interface FileStatCache {
  size: number;
  mtimeMs: number;
  session: Session;
}

export class ClaudeCodeAdapter implements Adapter {
  id = "claude-code";
  name = "Claude Code";
  icon = "◆";
  private projectsDir: string;
  private claudeDir: string;
  private statCache = new Map<string, FileStatCache>();

  constructor() {
    this.projectsDir = findProjectsDir();
    this.claudeDir = findClaudeDir();
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

      // Scan top-level JSONL files (main sessions + legacy agent- files)
      for (const file of readdirSync(dirPath)) {
        if (file.endsWith(".jsonl")) {
          const filePath = join(dirPath, file);
          await this.addSessionFromFile(filePath, file.startsWith("agent-"), "", sessions);
        }
      }

      // Scan nested subagents directories: <session-uuid>/subagents/agent-*.jsonl
      for (const entry of readdirSync(dirPath)) {
        const sessionSubDir = join(dirPath, entry, "subagents");
        try {
          if (!statSync(sessionSubDir).isDirectory()) continue;
          for (const agentFile of readdirSync(sessionSubDir)) {
            if (!agentFile.endsWith(".jsonl")) continue;
            const filePath = join(sessionSubDir, agentFile);
            await this.addSessionFromFile(filePath, true, entry, sessions);
          }
        } catch { /* not a directory or no subagents */ }
      }
    }

    // Prune cache entries for files no longer seen
    const seenPaths = new Set(sessions.map(s => s.sourcePath).filter(Boolean));
    for (const path of this.statCache.keys()) {
      if (!seenPaths.has(path)) this.statCache.delete(path);
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  private async addSessionFromFile(
    filePath: string, isSubAgent: boolean, parentSessionId: string, sessions: Session[]
  ): Promise<void> {
    try {
      const stat = statSync(filePath);

      // Stat cache: skip full re-parse if file hasn't changed
      const cached = this.statCache.get(filePath);
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        // Recompute isActive since it's time-dependent
        cached.session.isActive = Date.now() - new Date(cached.session.updatedAt).getTime() < 5 * 60 * 1000;
        sessions.push(cached.session);
        return;
      }

      const meta = await this.parseSessionMeta(filePath);
      if (!meta || meta.msgCount === 0) return;

      // Sub-agents share the parent's sessionId in JSONL, so use the filename as a unique ID
      const id = isSubAgent ? basename(filePath, ".jsonl") : meta.sessionId;

      const session: Session = {
        id,
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
        parentSessionId,
        isCompacted: meta.isCompacted,
        metadata: { cwd: meta.cwd, slug: meta.slug, fileSize: stat.size },
      };

      // Cache the result keyed by file path + stat
      this.statCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, session });
      sessions.push(session);
    } catch { /* skip unreadable files */ }
  }

  async messages(sessionId: string, sourcePath?: string): Promise<Message[]> {
    // Fast path: use the known source path if available
    if (sourcePath && existsSync(sourcePath)) {
      return this.parseMessages(sourcePath);
    }
    const filePath = await this.findSessionFile(sessionId);
    if (!filePath) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    // Return only the top-level projects directory with recursive watch.
    // Previously returned every subdirectory, causing overlapping watchers
    // that fired 3-6x per file change (each with recursive:true).
    if (!existsSync(this.projectsDir)) return [];
    return [this.projectsDir];
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    if (!existsSync(this.projectsDir)) return null;

    const checkFile = async (filePath: string): Promise<boolean> => {
      try {
        const firstLine = (await Bun.file(filePath).text()).split("\n")[0];
        if (!firstLine) return false;
        const parsed = JSON.parse(firstLine);
        return parsed.sessionId === sessionId || parsed.uuid === sessionId;
      } catch { return false; }
    };

    for (const projDir of readdirSync(this.projectsDir)) {
      const dirPath = join(this.projectsDir, projDir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;

        // Check top-level JSONL files
        for (const file of readdirSync(dirPath)) {
          if (!file.endsWith(".jsonl")) continue;
          const filePath = join(dirPath, file);
          // Match by filename (sub-agent IDs) or by JSONL content
          if (basename(file, ".jsonl") === sessionId || await checkFile(filePath)) return filePath;
        }

        // Check nested subagent directories: <uuid>/subagents/agent-*.jsonl
        for (const entry of readdirSync(dirPath)) {
          const subagentsDir = join(dirPath, entry, "subagents");
          try {
            if (!statSync(subagentsDir).isDirectory()) continue;
            for (const agentFile of readdirSync(subagentsDir)) {
              if (!agentFile.endsWith(".jsonl")) continue;
              const filePath = join(subagentsDir, agentFile);
              if (basename(agentFile, ".jsonl") === sessionId || await checkFile(filePath)) return filePath;
            }
          } catch { /* not a dir or no subagents */ }
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
    let isCompacted = false;
    let customTitle = "";
    let summary = "";

    for (const line of lines) {
      try {
        const raw: RawLine = JSON.parse(line);
        if (!sessionId && raw.sessionId) sessionId = raw.sessionId;
        if (!slug && raw.slug) slug = raw.slug;
        if (!cwd && raw.cwd) cwd = raw.cwd;

        // Capture custom-title entries (set via /rename, last one wins)
        if (raw.type === "custom-title" && raw.customTitle) {
          customTitle = raw.customTitle;
        }

        // Capture summary entries (auto-generated during compaction, last one wins)
        if (raw.type === "summary" && raw.summary) {
          summary = raw.summary;
        }

        // Detect compaction
        if (raw.type === "summary" || (raw.type === "system" && raw.subtype === "compact_boundary")) {
          isCompacted = true;
        }

        if (raw.type === "user" || raw.type === "assistant") {
          if (!firstMsg) firstMsg = raw.timestamp;
          lastMsg = raw.timestamp;
          msgCount++;

          if (raw.type === "user" && !firstUserMessage && raw.message?.content) {
            const content = raw.message.content;
            let candidate = "";
            if (typeof content === "string") {
              candidate = content;
            } else if (Array.isArray(content)) {
              const textBlock = (content as ContentBlock[]).find((b) => b.type === "text");
              if (textBlock?.text) candidate = textBlock.text;
            }
            // Skip synthetic messages injected on /resume
            if (candidate && !candidate.startsWith("[Request interrupted")) {
              firstUserMessage = candidate.slice(0, 120);
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

    // Strip XML tags used by Claude Code (system-reminder, tick, command-name, etc.)
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim().replace(/\n/g, " ");

    // Title priority matches Claude Code's /resume: customTitle > summary > firstPrompt > slug > id
    let name = "";
    if (customTitle) {
      name = stripTags(customTitle);
    } else if (summary && summary !== "No prompt") {
      name = stripTags(summary);
    } else {
      name = stripTags(firstUserMessage);
    }
    if (name.length > 120) name = name.slice(0, 117) + "...";

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
      isCompacted,
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

        // Capture summary records (compaction output)
        if (raw.type === "summary" && raw.summary) {
          messages.push({
            id: raw.uuid || `summary-${messages.length}`,
            role: "system",
            content: raw.summary,
            timestamp: raw.timestamp || "",
            model: "",
            inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
            toolUses: [], thinkingBlocks: [],
            recordType: "summary",
          });
          continue;
        }

        // Capture system records (init, compact_boundary)
        if (raw.type === "system") {
          const content = raw.subtype === "compact_boundary"
            ? JSON.stringify(raw.compactMetadata || {})
            : raw.subtype || "system";
          messages.push({
            id: raw.uuid || `system-${messages.length}`,
            role: "system",
            content,
            timestamp: raw.timestamp || "",
            model: "",
            inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
            toolUses: [], thinkingBlocks: [],
            recordType: raw.subtype ? `system:${raw.subtype}` : "system",
          });
          continue;
        }

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
          recordType: raw.type,
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

  /** Collect context artifacts: memory files, plans, todos, rules, configs, etc. */
  async artifacts(): Promise<ContextArtifact[]> {
    const artifacts: ContextArtifact[] = [];

    const addFile = (path: string, kind: ArtifactKind, name: string, scope: ContextArtifact["scope"]) => {
      if (!existsSync(path)) return;
      try {
        const stat = statSync(path);
        if (!stat.isFile()) return;
        const content = readFileSync(path, "utf-8");
        const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
        artifacts.push({
          id: `cc:${hash}:${basename(path)}`,
          adapterId: this.id,
          kind,
          name,
          path,
          scope,
          content: content.length > 100_000 ? content.slice(0, 100_000) + "\n...[truncated]" : content,
          contentHash: hash,
          updatedAt: stat.mtime.toISOString(),
          metadata: { size: stat.size },
        });
      } catch { /* skip unreadable */ }
    };

    const scanDir = (dir: string, kind: ArtifactKind, namePrefix: string, scope: ContextArtifact["scope"]) => {
      if (!existsSync(dir)) return;
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".md") || f.endsWith(".json") || f.endsWith(".jsonl")) {
            addFile(join(dir, f), kind, `${namePrefix}/${f}`, scope);
          }
        }
      } catch { /* skip */ }
    };

    // Global CLAUDE.md
    addFile(join(this.claudeDir, "CLAUDE.md"), "memory", "CLAUDE.md (global)", "global");

    // Global settings
    addFile(join(this.claudeDir, "settings.json"), "config", "settings.json (global)", "global");

    // Global rules
    scanDir(join(this.claudeDir, "rules"), "rules", "rules (global)", "global");

    // Global agents
    scanDir(join(this.claudeDir, "agents"), "agent-def", "agents (global)", "global");

    // Global commands/skills
    scanDir(join(this.claudeDir, "commands"), "skill", "commands (global)", "global");
    scanDir(join(this.claudeDir, "skills"), "skill", "skills (global)", "global");

    // Prompt history
    addFile(join(this.claudeDir, "history.jsonl"), "history", "history.jsonl", "global");

    // Stats cache
    addFile(join(this.claudeDir, "stats-cache.json"), "config", "stats-cache.json", "global");

    // MCP config (in ~/.claude.json)
    addFile(join(HOME, ".claude.json"), "mcp", ".claude.json (MCP + prefs)", "global");

    // Plans
    scanDir(join(this.claudeDir, "plans"), "plan", "plans", "global");

    // Per-project memory directories
    if (existsSync(this.projectsDir)) {
      for (const projDir of readdirSync(this.projectsDir)) {
        const memDir = join(this.projectsDir, projDir, "memory");
        if (existsSync(memDir)) {
          scanDir(memDir, "memory", `memory (${projDir})`, "project");
        }
      }
    }

    // Todos
    const todosDir = join(this.claudeDir, "todos");
    scanDir(todosDir, "todo", "todos", "session");

    // Tasks
    const tasksDir = join(this.claudeDir, "tasks");
    if (existsSync(tasksDir)) {
      try {
        for (const taskListDir of readdirSync(tasksDir)) {
          const tasksFile = join(tasksDir, taskListDir, "tasks.json");
          addFile(tasksFile, "todo", `tasks/${taskListDir}`, "session");
        }
      } catch { /* skip */ }
    }

    return artifacts;
  }
}
