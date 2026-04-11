import { watch, type FSWatcher } from "fs";
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
      const watcher = watch(path, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const key = `${adapterId}:${filename}`;

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
              sessionId: filename || "",
              timestamp: new Date().toISOString(),
              path: `${path}/${filename}`,
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
