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

function hasJsonlFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((d) => {
      const sub = join(dir, d);
      try {
        if (!statSync(sub).isDirectory()) return false;
        return readdirSync(sub).some((f) => f.endsWith(".jsonl"));
      } catch { return false; }
    });
  } catch { return false; }
}

function findProjectsDir(): string {
  const xdg = join(HOME, ".config", "claude", "projects");
  const legacy = join(HOME, ".claude", "projects");
  // Prefer whichever path actually contains session data
  if (existsSync(xdg) && hasJsonlFiles(xdg)) return xdg;
  if (existsSync(legacy) && hasJsonlFiles(legacy)) return legacy;
  // Fall back: prefer XDG if it exists, else legacy
  if (existsSync(xdg)) return xdg;
  if (existsSync(legacy)) return legacy;
  return xdg;
}

function findClaudeDir(): string {
  return join(HOME, ".claude");
}

/** Accumulated metadata that can be incrementally updated from new JSONL lines */
interface SessionMeta {
  sessionId: string;
  slug: string;
  cwd: string;
  firstMsg: string;
  lastMsg: string;
  msgCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  firstUserMessage: string;
  primaryModel: string;
  isCompacted: boolean;
  customTitle: string;
  summary: string;
}

interface FileOffsetCache {
  size: number;
  mtimeMs: number;
  offset: number;         // byte offset of last read position
  messageCount: number;   // total messages parsed so far
  meta: SessionMeta;      // accumulated metadata
  session: Session;       // built session object
}

export class ClaudeCodeAdapter implements Adapter {
  id = "claude-code";
  name = "Claude Code";
  icon = "◆";
  private projectsDir: string;
  private claudeDir: string;
  private fileCache = new Map<string, FileOffsetCache>();

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

      // Backpressure: yield between project directories so GC can reclaim
      // the file text buffers from parseSessionMetaFull() calls above.
      Bun.gc(false);
      await Bun.sleep(0);
    }

    // Prune cache entries for files no longer seen
    const seenPaths = new Set(sessions.map(s => s.sourcePath).filter(Boolean));
    for (const path of this.fileCache.keys()) {
      if (!seenPaths.has(path)) this.fileCache.delete(path);
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  /** Parse a single file into a Session without scanning all directories.
   *  Used by the watcher for targeted ingest of a known changed file. */
  async sessionForFile(filePath: string): Promise<Session | null> {
    const sessions: Session[] = [];
    const fileName = basename(filePath);
    const isSubAgent = fileName.startsWith("agent-");
    // Detect parent session ID from path: .../parent-uuid/subagents/agent-*.jsonl
    let parentSessionId = "";
    if (filePath.includes("/subagents/")) {
      const parts = filePath.split("/");
      const subIdx = parts.indexOf("subagents");
      if (subIdx > 0) parentSessionId = parts[subIdx - 1];
    }
    await this.addSessionFromFile(filePath, isSubAgent, parentSessionId, sessions);
    return sessions[0] || null;
  }

  private async addSessionFromFile(
    filePath: string, isSubAgent: boolean, parentSessionId: string, sessions: Session[]
  ): Promise<void> {
    try {
      const stat = statSync(filePath);
      const cached = this.fileCache.get(filePath);

      // Unchanged file — reuse cached session
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        cached.session.isActive = Date.now() - new Date(cached.session.updatedAt).getTime() < 5 * 60 * 1000;
        sessions.push(cached.session);
        return;
      }

      // Determine read strategy: tail (append) or full (new/truncated)
      let meta: SessionMeta;
      let newOffset: number;

      if (cached && stat.size > cached.offset) {
        // TAIL READ: file grew — read only new bytes, update metadata incrementally
        const blob = Bun.file(filePath).slice(cached.offset);
        const newText = await blob.text();
        const newLines = newText.split("\n").filter(Boolean);
        meta = { ...cached.meta }; // clone to avoid mutating cache before success
        for (const line of newLines) {
          try {
            this.updateMetaFromLine(meta, JSON.parse(line));
          } catch { continue; }
        }
        newOffset = stat.size;
      } else {
        // FULL READ: new file or truncated — parse from byte 0
        meta = await this.parseSessionMetaFull(filePath);
        if (!meta || meta.msgCount === 0) return;
        newOffset = stat.size;
      }

      if (meta.msgCount === 0) return;

      // Sub-agents share the parent's sessionId in JSONL, so use the filename as a unique ID
      const id = isSubAgent ? basename(filePath, ".jsonl") : meta.sessionId;

      const session: Session = {
        id,
        name: this.buildSessionName(meta),
        adapterId: this.id,
        adapterName: this.name,
        createdAt: meta.firstMsg,
        updatedAt: meta.lastMsg,
        durationMs: new Date(meta.lastMsg).getTime() - new Date(meta.firstMsg).getTime(),
        isActive: Date.now() - new Date(meta.lastMsg).getTime() < 5 * 60 * 1000,
        totalTokens: meta.totalInputTokens + meta.totalOutputTokens,
        estCost: estimateCost(meta.primaryModel, meta.totalInputTokens, meta.totalOutputTokens, meta.totalCacheRead, meta.totalCacheWrite),
        messageCount: meta.msgCount,
        sourcePath: filePath,
        isSubAgent,
        parentSessionId,
        isCompacted: meta.isCompacted,
        metadata: { cwd: meta.cwd, slug: meta.slug, fileSize: stat.size },
      };

      this.fileCache.set(filePath, {
        size: stat.size, mtimeMs: stat.mtimeMs,
        offset: newOffset, messageCount: meta.msgCount,
        meta, session,
      });
      sessions.push(session);
    } catch { /* skip unreadable files */ }
  }

  /** Update accumulated metadata from a single parsed JSONL line */
  private updateMetaFromLine(meta: SessionMeta, raw: RawLine): void {
    if (!meta.sessionId && raw.sessionId) meta.sessionId = raw.sessionId;
    if (!meta.slug && raw.slug) meta.slug = raw.slug;
    if (!meta.cwd && raw.cwd) meta.cwd = raw.cwd;

    // Capture custom-title entries (set via /rename, last one wins)
    if (raw.type === "custom-title" && raw.customTitle) {
      meta.customTitle = raw.customTitle;
    }

    // Capture summary entries (auto-generated during compaction, last one wins)
    if (raw.type === "summary" && raw.summary) {
      meta.summary = raw.summary;
    }

    if (raw.type === "summary" || (raw.type === "system" && raw.subtype === "compact_boundary")) {
      meta.isCompacted = true;
    }

    if (raw.type === "user" || raw.type === "assistant") {
      if (!meta.firstMsg) meta.firstMsg = raw.timestamp;
      meta.lastMsg = raw.timestamp;
      meta.msgCount++;

      if (raw.type === "user" && !meta.firstUserMessage && raw.message?.content) {
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
          meta.firstUserMessage = candidate.slice(0, 120);
        }
      }

      if (raw.message?.usage) {
        meta.totalInputTokens += raw.message.usage.input_tokens || 0;
        meta.totalOutputTokens += raw.message.usage.output_tokens || 0;
        meta.totalCacheRead += raw.message.usage.cache_read_input_tokens || 0;
        meta.totalCacheWrite += raw.message.usage.cache_creation_input_tokens || 0;
      }
      if (raw.message?.model && !meta.primaryModel) {
        meta.primaryModel = raw.message.model;
      }
    }
  }

  private buildSessionName(meta: SessionMeta): string {
    // Strip XML tags used by Claude Code (system-reminder, tick, command-name, etc.)
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim().replace(/\n/g, " ");

    // Title priority matches Claude Code's /resume: customTitle > summary > firstPrompt > slug > id
    let name = "";
    if (meta.customTitle) {
      name = stripTags(meta.customTitle);
    } else if (meta.summary && meta.summary !== "No prompt") {
      name = stripTags(meta.summary);
    } else {
      name = stripTags(meta.firstUserMessage);
    }
    if (name.length > 120) name = name.slice(0, 117) + "...";
    return name || meta.slug || meta.sessionId.slice(0, 8);
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

  /** Return only messages added since the given count (for delta SQLite inserts) */
  async newMessages(sessionId: string, sourcePath: string, afterIndex: number): Promise<Message[]> {
    if (!sourcePath || !existsSync(sourcePath)) return [];
    const all = await this.parseMessages(sourcePath);
    return afterIndex > 0 && afterIndex < all.length ? all.slice(afterIndex) : all;
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

  /** Full parse from byte 0 — used for new files or truncated files */
  private async parseSessionMetaFull(filePath: string): Promise<SessionMeta> {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);

    const meta: SessionMeta = {
      sessionId: "", slug: "", cwd: "",
      firstMsg: "", lastMsg: "",
      msgCount: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheRead: 0, totalCacheWrite: 0,
      firstUserMessage: "", primaryModel: "",
      isCompacted: false,
      customTitle: "", summary: "",
    };

    for (const line of lines) {
      try {
        this.updateMetaFromLine(meta, JSON.parse(line));
      } catch { continue; }
    }

    if (!meta.sessionId) meta.sessionId = basename(filePath, ".jsonl");
    if (!meta.firstMsg) meta.firstMsg = new Date().toISOString();
    if (!meta.lastMsg) meta.lastMsg = new Date().toISOString();

    return meta;
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
