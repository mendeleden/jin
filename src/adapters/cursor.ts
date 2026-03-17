import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import type { Adapter, Session, Message } from "./types";

// ─── Platform path resolution ────────────────────────────────────────────────

function findCursorConfigDir(): string {
  const home = homedir();
  const p = platform();
  const candidates: string[] = [];

  if (p === "darwin") {
    candidates.push(join(home, "Library", "Application Support", "Cursor"));
  }
  if (p === "win32") {
    candidates.push(join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Cursor"));
  }
  if (p === "linux") {
    const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
    candidates.push(join(xdg, "Cursor"));
  }

  for (const c of candidates) {
    if (existsSync(join(c, "User", "globalStorage", "state.vscdb"))) return c;
  }
  return candidates[0] || "";
}

function legacyChatsDir(): string {
  return join(homedir(), ".cursor", "chats");
}

// ─── Types for vscdb format ──────────────────────────────────────────────────

interface ComposerIndex {
  composerId: string;
  name?: string;
  lastUpdatedAt: number;
  createdAt: number;
  unifiedMode?: string;
  forceMode?: string;
  numSubComposers?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  filesChangedCount?: number;
  subtitle?: string;
  isArchived?: boolean;
}

interface ComposerData {
  composerId: string;
  name?: string;
  createdAt: number;
  status?: string;
  unifiedMode?: string;
  isAgentic?: boolean;
  modelConfig?: { modelName?: string };
  fullConversationHeadersOnly: { bubbleId: string; type: number }[];
  subagentComposerIds?: string[];
}

interface BubbleData {
  bubbleId: string;
  type: number; // 1=user, 2=assistant
  text?: string;
  richText?: string;
  createdAt?: string;
  capabilityType?: number; // 30=thinking, 15=tool
  thinking?: { text?: string; signature?: string };
  thinkingDurationMs?: number;
  toolFormerData?: {
    name?: string;
    status?: string;
    toolCallId?: string;
    additionalData?: Record<string, unknown>;
  };
  tokenCount?: { inputTokens?: number; outputTokens?: number };
  modelInfo?: { modelName?: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function openReadonly(dbPath: string): Database | null {
  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

function kvGet(db: Database, table: string, key: string): any | null {
  try {
    const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key) as any;
    if (!row?.value) return null;
    const str = typeof row.value === "string" ? row.value : Buffer.from(row.value).toString("utf-8");
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function readWorkspacePath(wsDir: string): string {
  try {
    const raw = readFileSync(join(wsDir, "workspace.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const folder: string = parsed.folder || "";
    return folder.replace(/^file:\/\//, "");
  } catch {
    return "";
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class CursorAdapter implements Adapter {
  id = "cursor";
  name = "Cursor";
  icon = "▌";

  private configDir: string;
  private globalDbPath: string;
  private workspaceStorageDir: string;
  private legacyDir: string;

  constructor() {
    this.configDir = findCursorConfigDir();
    this.globalDbPath = join(this.configDir, "User", "globalStorage", "state.vscdb");
    this.workspaceStorageDir = join(this.configDir, "User", "workspaceStorage");
    this.legacyDir = legacyChatsDir();
  }

  // ─── detect ──────────────────────────────────────────────────────────────

  async detect(): Promise<boolean> {
    // New format
    if (existsSync(this.globalDbPath)) {
      const db = openReadonly(this.globalDbPath);
      if (db) {
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'").all();
          if (tables.length > 0) return true;
        } catch {} finally { db.close(); }
      }
    }
    // Legacy format
    return this.detectLegacy();
  }

  // ─── sessions ────────────────────────────────────────────────────────────

  async sessions(): Promise<Session[]> {
    const vscdbSessions = this.vscdbSessions();
    const legacy = this.legacySessions();

    // Deduplicate: prefer new format
    const seen = new Set(vscdbSessions.map(s => s.id));
    for (const s of legacy) {
      if (!seen.has(s.id)) {
        vscdbSessions.push(s);
        seen.add(s.id);
      }
    }

    vscdbSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return vscdbSessions;
  }

  // ─── messages ────────────────────────────────────────────────────────────

  async messages(sessionId: string, sourcePath?: string): Promise<Message[]> {
    // Try new format first
    const dbPath = sourcePath || this.globalDbPath;
    if (existsSync(dbPath)) {
      const msgs = this.vscdbMessages(sessionId, dbPath);
      if (msgs.length > 0) return msgs;
    }
    // Legacy fallback
    const legacyDb = this.findLegacySessionDb(sessionId);
    if (legacyDb) return this.legacyMessages(legacyDb);
    return [];
  }

  // ─── watchPaths ──────────────────────────────────────────────────────────

  watchPaths(): string[] {
    const paths: string[] = [];
    if (existsSync(this.globalDbPath)) paths.push(this.globalDbPath);
    if (existsSync(this.legacyDir)) paths.push(this.legacyDir);
    return paths;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // New format (state.vscdb)
  // ═══════════════════════════════════════════════════════════════════════════

  private vscdbSessions(): Session[] {
    if (!existsSync(this.globalDbPath)) return [];

    const globalDb = openReadonly(this.globalDbPath);
    if (!globalDb) return [];

    try {
      // Build parent map from global composerData entries
      const parentMap = this.buildParentMap(globalDb);

      // Collect message counts from global composerData
      const messageCounts = new Map<string, number>();
      const composerNames = new Map<string, string>();

      const sessions: Session[] = [];

      // Scan each workspace
      if (!existsSync(this.workspaceStorageDir)) return [];
      for (const wsHash of readdirSync(this.workspaceStorageDir)) {
        const wsDir = join(this.workspaceStorageDir, wsHash);
        const wsDbPath = join(wsDir, "state.vscdb");
        if (!existsSync(wsDbPath)) continue;

        const workspacePath = readWorkspacePath(wsDir);
        const wsDb = openReadonly(wsDbPath);
        if (!wsDb) continue;

        try {
          const index = kvGet(wsDb, "ItemTable", "composer.composerData");
          if (!index?.allComposers) continue;

          for (const c of index.allComposers as ComposerIndex[]) {
            try {
            // Get message count + name from global composerData if not cached
            if (!messageCounts.has(c.composerId)) {
              const cd = kvGet(globalDb, "cursorDiskKV", `composerData:${c.composerId}`) as ComposerData | null;
              if (cd) {
                messageCounts.set(c.composerId, cd.fullConversationHeadersOnly?.length || 0);
                if (cd.name) composerNames.set(c.composerId, cd.name);
              }
            }

            const createdMs = c.createdAt || 0;
            const updatedMs = c.lastUpdatedAt || c.createdAt || 0;
            const createdAt = createdMs ? new Date(createdMs).toISOString() : new Date().toISOString();
            const updatedAt = updatedMs ? new Date(updatedMs).toISOString() : createdAt;
            const name = c.name || composerNames.get(c.composerId) || c.subtitle?.slice(0, 60) || c.composerId.slice(0, 8);

            sessions.push({
              id: c.composerId,
              name,
              adapterId: this.id,
              adapterName: this.name,
              createdAt,
              updatedAt,
              durationMs: updatedMs - createdMs,
              isActive: Date.now() - updatedMs < 5 * 60 * 1000,
              totalTokens: 0,
              estCost: 0,
              messageCount: messageCounts.get(c.composerId) || 0,
              sourcePath: this.globalDbPath,
              isSubAgent: parentMap.has(c.composerId),
              parentSessionId: parentMap.get(c.composerId) || "",
              isCompacted: false,
              metadata: {
                workspace: workspacePath,
                unifiedMode: c.unifiedMode,
                forceMode: c.forceMode,
                linesAdded: c.totalLinesAdded,
                linesRemoved: c.totalLinesRemoved,
                filesChanged: c.filesChangedCount,
              },
            });
            } catch { continue; }
          }
        } catch {} finally { wsDb.close(); }
      }

      return sessions;
    } finally { globalDb.close(); }
  }

  private buildParentMap(globalDb: Database): Map<string, string> {
    const parentMap = new Map<string, string>();
    try {
      const rows = globalDb.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
      ).all() as any[];
      for (const row of rows) {
        try {
          const val = JSON.parse(
            typeof row.value === "string" ? row.value : Buffer.from(row.value).toString("utf-8")
          ) as ComposerData;
          if (val.subagentComposerIds && val.subagentComposerIds.length > 0) {
            for (const childId of val.subagentComposerIds) {
              parentMap.set(childId, val.composerId);
            }
          }
        } catch {}
      }
    } catch {}
    return parentMap;
  }

  private vscdbMessages(sessionId: string, dbPath: string): Message[] {
    const db = openReadonly(dbPath);
    if (!db) return [];

    try {
      const cd = kvGet(db, "cursorDiskKV", `composerData:${sessionId}`) as ComposerData | null;
      if (!cd?.fullConversationHeadersOnly?.length) return [];

      const messages: Message[] = [];

      for (const header of cd.fullConversationHeadersOnly) {
        const bubble = kvGet(db, "cursorDiskKV", `bubbleId:${sessionId}:${header.bubbleId}`) as BubbleData | null;
        if (!bubble) continue;

        const hasText = bubble.text && bubble.text.trim().length > 0;
        const hasThinking = bubble.thinking?.text && bubble.thinking.text.length > 0;
        const hasTool = bubble.toolFormerData?.name;

        // Skip empty placeholder bubbles
        if (!hasText && !hasThinking && !hasTool) continue;

        const toolUses = hasTool ? [{
          id: bubble.toolFormerData!.toolCallId || bubble.bubbleId,
          name: bubble.toolFormerData!.name!,
          input: bubble.toolFormerData!.additionalData ? JSON.stringify(bubble.toolFormerData!.additionalData) : "",
          output: "",
        }] : [];

        const thinkingBlocks = hasThinking ? [{
          content: bubble.thinking!.text!,
          tokenCount: 0,
        }] : [];

        messages.push({
          id: bubble.bubbleId,
          role: header.type === 1 ? "user" : "assistant",
          content: bubble.text || "",
          timestamp: bubble.createdAt || "",
          model: bubble.modelInfo?.modelName || "",
          inputTokens: bubble.tokenCount?.inputTokens || 0,
          outputTokens: bubble.tokenCount?.outputTokens || 0,
          cacheRead: 0,
          cacheWrite: 0,
          toolUses,
          thinkingBlocks,
          recordType: "",
        });
      }

      return messages;
    } finally { db.close(); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy format (~/.cursor/chats/<workspace>/<session>/store.db)
  // ═══════════════════════════════════════════════════════════════════════════

  private detectLegacy(): boolean {
    if (!existsSync(this.legacyDir)) return false;
    try {
      return readdirSync(this.legacyDir).some((ws) => {
        const wsPath = join(this.legacyDir, ws);
        if (!statSync(wsPath).isDirectory()) return false;
        return readdirSync(wsPath).some((sess) => existsSync(join(wsPath, sess, "store.db")));
      });
    } catch {
      return false;
    }
  }

  private legacySessions(): Session[] {
    if (!existsSync(this.legacyDir)) return [];
    const sessions: Session[] = [];

    for (const wsDir of readdirSync(this.legacyDir)) {
      const wsPath = join(this.legacyDir, wsDir);
      try { if (!statSync(wsPath).isDirectory()) continue; } catch { continue; }

      for (const sessDir of readdirSync(wsPath)) {
        const dbPath = join(wsPath, sessDir, "store.db");
        if (!existsSync(dbPath)) continue;

        try {
          const meta = this.readLegacyMeta(dbPath);
          if (!meta) continue;

          const stat = statSync(dbPath);
          const name = (meta.name && meta.name !== "New Agent") ? meta.name : sessDir.slice(0, 8);

          sessions.push({
            id: meta.agentId || sessDir,
            name,
            adapterId: this.id,
            adapterName: this.name,
            createdAt: meta.createdAt || stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            durationMs: stat.mtime.getTime() - (meta.createdAt ? new Date(meta.createdAt).getTime() : stat.birthtime.getTime()),
            isActive: Date.now() - stat.mtime.getTime() < 5 * 60 * 1000,
            totalTokens: 0,
            estCost: 0,
            messageCount: 0,
            sourcePath: dbPath,
            isSubAgent: false,
            parentSessionId: "",
            isCompacted: false,
            metadata: { workspace: wsDir },
          });
        } catch { continue; }
      }
    }

    return sessions;
  }

  private readLegacyMeta(dbPath: string): { agentId: string; name: string; createdAt: string } | null {
    const db = openReadonly(dbPath);
    if (!db) return null;
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = '0'").get() as any;
      if (!row?.value) return null;
      const jsonStr = Buffer.from(row.value, "hex").toString("utf-8");
      const meta = JSON.parse(jsonStr);
      return {
        agentId: meta.agentId || meta.id || "",
        name: meta.name || "",
        createdAt: meta.createdAt ? new Date(meta.createdAt).toISOString() : "",
      };
    } catch {
      return null;
    } finally { db.close(); }
  }

  private legacyMessages(dbPath: string): Message[] {
    const db = openReadonly(dbPath);
    if (!db) return [];
    try {
      const metaRow = db.prepare("SELECT value FROM meta WHERE key = '0'").get() as any;
      if (!metaRow?.value) return [];
      const meta = JSON.parse(Buffer.from(metaRow.value, "hex").toString("utf-8"));

      const blobs = new Map<string, Uint8Array | Buffer>();
      const rows = db.prepare("SELECT id, data FROM blobs").all() as any[];
      for (const row of rows) blobs.set(row.id, row.data);

      const messages: Message[] = [];
      this.collectLegacyMessages(blobs, meta.latestRootBlobId, messages);

      // Interpolate timestamps (legacy format has no per-message timestamps)
      if (messages.length > 0) {
        const startTime = meta.createdAt ? new Date(meta.createdAt).getTime() : Date.now();
        const endTime = statSync(dbPath).mtime.getTime();
        const duration = endTime - startTime;
        for (let i = 0; i < messages.length; i++) {
          const progress = messages.length === 1 ? 0 : i / (messages.length - 1);
          messages[i].timestamp = new Date(startTime + duration * progress).toISOString();
        }
      }

      return messages;
    } catch {
      return [];
    } finally { db.close(); }
  }

  private collectLegacyMessages(blobs: Map<string, Uint8Array | Buffer>, rootId: string, messages: Message[]): void {
    if (!rootId || !blobs.has(rootId)) return;
    try {
      const raw = blobs.get(rootId)!;
      const jsonStr = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf-8");
      const data = JSON.parse(jsonStr);
      if (data.parentId) this.collectLegacyMessages(blobs, data.parentId, messages);

      if (data.role && data.content !== undefined) {
        const content = typeof data.content === "string"
          ? data.content
          : Array.isArray(data.content)
            ? data.content.map((b: any) => b.text || "").join("\n")
            : JSON.stringify(data.content);

        messages.push({
          id: rootId,
          role: data.role === "user" ? "user" : "assistant",
          content,
          timestamp: "",
          model: data.model || "",
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          toolUses: [],
          thinkingBlocks: [],
          recordType: "",
        });
      }
    } catch {}
  }

  private findLegacySessionDb(sessionId: string): string | null {
    if (!existsSync(this.legacyDir)) return null;
    for (const wsDir of readdirSync(this.legacyDir)) {
      const wsPath = join(this.legacyDir, wsDir);
      try {
        if (!statSync(wsPath).isDirectory()) continue;
        const dbPath = join(wsPath, sessionId, "store.db");
        if (existsSync(dbPath)) return dbPath;
      } catch { continue; }
    }
    return null;
  }
}
