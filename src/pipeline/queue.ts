import type { PipelineWorkItem } from "./types";

export type WorkQueueEnqueueResult = "queued" | "coalesced" | "handed-off";

export class WorkQueue {
  private readonly items: PipelineWorkItem[] = [];
  private readonly waiters: Array<(item: PipelineWorkItem) => void> = [];

  enqueue(item: PipelineWorkItem): WorkQueueEnqueueResult {
    if (this.tryCoalesce(item)) {
      return "coalesced";
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return "handed-off";
    }

    this.items.push(item);
    return "queued";
  }

  async take(): Promise<PipelineWorkItem> {
    const item = this.items.shift();
    if (item) {
      return item;
    }

    return new Promise<PipelineWorkItem>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  enqueuePriority(item: PipelineWorkItem): WorkQueueEnqueueResult {
    if (this.hasEquivalentQueuedItem(item)) {
      return "coalesced";
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return "handed-off";
    }

    this.items.unshift(item);
    return "queued";
  }

  discard(
    predicate: (item: PipelineWorkItem) => boolean = () => true,
  ): number {
    const kept: PipelineWorkItem[] = [];
    let discarded = 0;

    for (const item of this.items) {
      if (predicate(item)) {
        discarded += 1;
      } else {
        kept.push(item);
      }
    }

    this.items.splice(0, this.items.length, ...kept);
    return discarded;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  get size(): number {
    return this.items.length;
  }

  snapshot(): string[] {
    return this.items.map((item) => {
      if (item.kind === "ingest-adapter") return `${item.kind}:${item.adapterId}`;
      return item.kind;
    });
  }

  private tryCoalesce(next: PipelineWorkItem): boolean {
    const tail = this.items.at(-1);
    if (!tail) {
      return false;
    }

    if (tail.kind === "push" && next.kind === "push") {
      return true;
    }

    if (
      tail.kind === "reconcile-adapters" &&
      next.kind === "reconcile-adapters"
    ) {
      return true;
    }

    if (
      tail.kind === "ingest-adapter" &&
      next.kind === "ingest-adapter" &&
      tail.adapterId === next.adapterId &&
      tail.hint.kind === "fs-change" &&
      next.hint.kind === "fs-change"
    ) {
      tail.hint = {
        kind: "fs-change",
        changedPaths: mergeChangedPaths(
          tail.hint.changedPaths,
          next.hint.changedPaths,
        ),
      };
      return true;
    }

    return false;
  }

  private hasEquivalentQueuedItem(next: PipelineWorkItem): boolean {
    return this.items.some((item) => {
      if (item.kind !== next.kind) {
        return false;
      }

      if (item.kind === "config-reload" && next.kind === "config-reload") {
        return true;
      }

      return false;
    });
  }
}

function mergeChangedPaths(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  if (merged.length === 0) {
    return undefined;
  }

  return [...new Set(merged)];
}
