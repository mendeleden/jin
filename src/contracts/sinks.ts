import type { Conversation, Message, ToolCall } from "./conversations";

export interface SinkHealth {
  ok: boolean;
  error?: string;
}

export interface PushPayload {
  attemptedRevision: number;
  conversation: Conversation;
  messages: Message[];
  toolCalls: ToolCall[];
}

export interface PushError {
  conversationId: string;
  error: string;
}

export interface PushResult {
  pushed: number;
  failed: number;
  errors: PushError[];
}

export interface Sink {
  id: string;
  name: string;
  push(payloads: PushPayload[]): Promise<PushResult>;
  healthCheck(): Promise<SinkHealth>;
  close(): Promise<void>;
}
