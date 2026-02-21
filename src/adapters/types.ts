// Adapter interface — each coding tool implements this to expose its conversation data
// and surrounding context artifacts (memory files, configs, rules, etc.).

export interface Adapter {
  id: string;
  name: string;
  icon: string;

  /** Check if this tool's data is present on the system. */
  detect(): Promise<boolean>;

  /** List all sessions found for this tool. */
  sessions(): Promise<Session[]>;

  /** Load all messages for a given session. */
  messages(sessionId: string): Promise<Message[]>;

  /** Return directories to watch for changes. */
  watchPaths(): string[];

  /** Collect context artifacts (memory files, configs, rules, instructions). */
  artifacts?(): Promise<ContextArtifact[]>;
}

export interface Session {
  id: string;
  name: string;
  adapterId: string;
  adapterName: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  durationMs: number;
  isActive: boolean;
  totalTokens: number;
  estCost: number;
  messageCount: number;
  sourcePath: string;
  isSubAgent: boolean;
  parentSessionId: string; // for sub-agent/subtask linkage
  isCompacted: boolean;    // whether session has been compacted
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO 8601
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  toolUses: ToolUse[];
  thinkingBlocks: ThinkingBlock[];
  /** Record type from source (e.g. "summary", "compact_boundary", "session_meta") */
  recordType: string;
}

export interface ToolUse {
  id: string;
  name: string;
  input: string;
  output: string;
}

export interface ThinkingBlock {
  content: string;
  tokenCount: number;
}

// --- Context artifacts: memory files, configs, rules, instructions ---

export type ArtifactKind =
  | "memory"        // CLAUDE.md, AGENTS.md, GEMINI.md, SOUL.md, etc.
  | "rules"         // .claude/rules/*.md, .cursor/rules/*.mdc, etc.
  | "config"        // settings.json, config.toml, opencode.json, etc.
  | "instructions"  // AGENTS.md, SYSTEM.md, per-project instructions
  | "plan"          // plan mode documents
  | "todo"          // persisted todo/task lists
  | "skill"         // SKILL.md files, custom commands
  | "checkpoint"    // file-history snapshots, session diffs
  | "history"       // cross-session prompt history (history.jsonl)
  | "mcp"           // MCP server configurations
  | "agent-def"     // sub-agent/custom agent definitions
  | "workspace";    // OpenClaw workspace files (SOUL.md, IDENTITY.md, etc.)

export interface ContextArtifact {
  id: string;                 // stable identifier (e.g. hash of path)
  adapterId: string;
  kind: ArtifactKind;
  name: string;               // human label (e.g. "CLAUDE.md (global)")
  path: string;               // absolute path on disk
  scope: "global" | "project" | "session" | "local";
  content: string;            // file contents (or summary for large files)
  contentHash: string;        // for change detection
  updatedAt: string;          // ISO 8601
  metadata: Record<string, unknown>;
}

export interface WatchEvent {
  type: "session_created" | "session_updated" | "message_added" | "artifact_changed";
  adapterId: string;
  sessionId: string;
  timestamp: string;
  path: string;
}
