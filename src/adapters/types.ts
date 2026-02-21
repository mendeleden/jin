// Adapter interface — each coding tool implements this to expose its conversation data.

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
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  toolUses: ToolUse[];
  thinkingBlocks: ThinkingBlock[];
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

export interface WatchEvent {
  type: "session_created" | "session_updated" | "message_added";
  adapterId: string;
  sessionId: string;
  timestamp: string;
  path: string;
}
