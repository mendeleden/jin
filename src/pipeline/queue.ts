import type { PipelineWorkItem } from "./types";

export class WorkQueue {
  private readonly items: PipelineWorkItem[] = [];
  private readonly waiters: Array<(item: PipelineWorkItem) => void> = [];

  enqueue(item: PipelineWorkItem): boolean {
    if (this.tryCoalesce(item)) {
      return true;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return true;
    }

    this.items.push(item);
    return true;
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
