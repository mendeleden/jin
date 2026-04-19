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
  /**
   * Optional heavy-adapter hook to drop temporary per-load state after a batch.
   * Safe no-op for adapters that do not retain transient parse state.
   */
  releaseTransientMemory?(): void;
  /**
   * Optional heavy-adapter hook to drop discovery-only temporary state after a
   * discovery cycle while preserving any lightweight durable index that must
   * survive into cache export or the next scan.
   */
  releaseDiscoveryMemory?(): void;
}
