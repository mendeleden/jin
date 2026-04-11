export const CONVERSATION_RELATIONSHIPS = [
  "root",
  "compacted",
  "spawned",
  "forked",
] as const;

export type ConversationRelationship =
  (typeof CONVERSATION_RELATIONSHIPS)[number];

export const CONVERSATION_SOURCE_FORMATS = [
  "jsonl",
  "sqlite",
  "json",
] as const;

export type ConversationSourceFormat =
  (typeof CONVERSATION_SOURCE_FORMATS)[number];

export interface ConversationRef {
  id: string;
  sourcePath: string;
  adapterId: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  input: string;
  output: string;
  isError: boolean;
  durationMs: number;
  timestamp: string;
}

export interface ParsedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  recordType: string;
  model: string;
  sequence: number;
  turn: number;
  isSidechain: boolean;
  parentMessageId: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  thinkingContent: string;
  thinkingTokens: number;
  timestamp: string;
  toolUses: ParsedToolCall[];
}

export interface ParsedConversation {
  id: string;
  traceId: string;
  parentId: string;
  relationship: ConversationRelationship;
  forkPoint: number;
  adapterId: string;
  name: string;
  cwd: string;
  gitRemote: string;
  branch: string;
  model: string;
  startedAt: string;
  endedAt: string;
  sourcePath: string;
  sourceFormat: ConversationSourceFormat;
}

export interface ConversationBundle {
  conversation: ParsedConversation;
  messages: ParsedMessage[];
}

export interface Conversation extends ParsedConversation {
  durationMs: number;
  messageCount: number;
  toolCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  estCost: number;
}

export interface Message extends ParsedMessage {
  conversationId: string;
}

export interface ToolCall extends ParsedToolCall {
  conversationId: string;
  messageId: string;
}
