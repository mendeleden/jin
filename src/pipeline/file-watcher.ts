import { statSync, watch, type FSWatcher } from "fs";
import { basename, join } from "path";
import type { WatchEvent } from "../adapters/types";

interface WatcherOptions {
  debounceMs: number;
  onChange: (event: WatchEvent) => void;
}

export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, Timer>();
  private opts: WatcherOptions;

  constructor(opts: WatcherOptions) {
    this.opts = opts;
  }

  addPath(path: string, adapterId: string): void {
    try {
      const recursive = statSync(path).isDirectory();
      const watcher = watch(path, { recursive }, (eventType, filename) => {
        const reportedName = recursive
          ? filename?.toString()
          : basename(path);
        if (!reportedName) return;
        const changedPath = recursive ? join(path, reportedName) : path;
        const key = `${adapterId}:${changedPath}`;

        // Debounce rapid changes
        if (this.debounceTimers.has(key)) {
          clearTimeout(this.debounceTimers.get(key)!);
        }

        this.debounceTimers.set(
          key,
          setTimeout(() => {
            this.debounceTimers.delete(key);
            const watchEvent: WatchEvent = {
              type: eventType === "rename" ? "session_created" : "session_updated",
              adapterId,
              sessionId: reportedName,
              timestamp: new Date().toISOString(),
              path: changedPath,
            };
            this.opts.onChange(watchEvent);
          }, this.opts.debounceMs)
        );
      });
      this.watchers.push(watcher);
    } catch (err) {
      // Directory may not exist yet — skip silently
    }
  }

  close(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
  }
}
