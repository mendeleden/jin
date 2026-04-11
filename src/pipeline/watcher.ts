import { FileWatcher } from "./file-watcher";
import {
  DEFAULT_WATCH_DEBOUNCE_MS,
} from "../contracts/pipeline";
import type { Adapter } from "../contracts/adapters";
import type {
  PipelineWatchEvent,
  PipelineWatcher,
  PipelineWatcherFactory,
} from "./types";

export class WatcherController {
  private watcher: PipelineWatcher;
  private readonly debounceMs: number;
  private readonly onChange: (event: PipelineWatchEvent) => void;
  private readonly watcherFactory?: PipelineWatcherFactory;

  constructor(options: {
    debounceMs?: number;
    onChange: (event: PipelineWatchEvent) => void;
    watcherFactory?: PipelineWatcherFactory;
  }) {
    this.debounceMs = options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
    this.onChange = options.onChange;
    this.watcherFactory = options.watcherFactory;
    this.watcher = createWatcher(this.watcherFactory, {
      debounceMs: this.debounceMs,
      onChange: this.onChange,
    });
  }

  reconcile(adapters: ReadonlyArray<Adapter>): void {
    this.watcher.close();
    this.watcher = createWatcher(this.watcherFactory, {
      debounceMs: this.debounceMs,
      onChange: this.onChange,
    });

    for (const adapter of adapters) {
      for (const path of adapter.watchPaths()) {
        this.watcher.addPath(path, adapter.id);
      }
    }
  }

  close(): void {
    this.watcher.close();
  }
}

export function createDefaultWatcherFactory(): PipelineWatcherFactory {
  return ({ debounceMs, onChange }) => {
    const watcher = new FileWatcher({
      debounceMs,
      onChange: (event) =>
        onChange({
          adapterId: event.adapterId,
          path: event.path,
        }),
    });

    return {
      addPath(path: string, adapterId: string) {
        watcher.addPath(path, adapterId);
      },
      close() {
        watcher.close();
      },
    };
  };
}

function createWatcher(
  watcherFactory: PipelineWatcherFactory | undefined,
  options: {
    debounceMs: number;
    onChange: (event: PipelineWatchEvent) => void;
  },
): PipelineWatcher {
  return (watcherFactory ?? createDefaultWatcherFactory())(options);
}
