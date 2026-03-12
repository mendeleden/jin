import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { configDir } from "./config";

function progressFile(): string {
  return join(configDir(), "jin.progress");
}

export interface IngestProgress {
  adapter: string;
  current: number;
  total: number;
  startedAt: number; // epoch ms
}

export function writeProgress(progress: IngestProgress): void {
  try {
    writeFileSync(progressFile(), JSON.stringify(progress));
  } catch {}
}

export function readProgress(): IngestProgress | null {
  if (!existsSync(progressFile())) return null;
  try {
    const data = JSON.parse(readFileSync(progressFile(), "utf-8"));
    // Stale check: if progress file is older than 5 minutes, ignore it
    if (Date.now() - data.startedAt > 5 * 60 * 1000) {
      clearProgress();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try { unlinkSync(progressFile()); } catch {}
}
