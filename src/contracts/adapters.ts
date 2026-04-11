import type { ConversationBundle, ConversationRef } from "./conversations";

export const ADAPTER_CHANGE_HINT_KINDS = [
  "startup-scan",
  "fs-change",
  "periodic-scan",
] as const;

export type ChangeHintKind = (typeof ADAPTER_CHANGE_HINT_KINDS)[number];

export interface ChangeHint {
  kind: ChangeHintKind;
  changedPaths?: string[];
}

export interface Adapter {
  id: string;
  name: string;
  detect(): Promise<boolean>;
  findChanged(hint?: ChangeHint): Promise<ConversationRef[]>;
  loadConversation(ref: ConversationRef): Promise<ConversationBundle | null>;
  watchPaths(): string[];
}
