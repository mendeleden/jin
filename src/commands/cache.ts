import { existsSync } from "fs";
import { discoveryCachePath } from "../config";
import { getRuntimeStatus } from "../daemon/runtime-state";
import { rmSync } from "fs";

export async function cacheClearCommand(): Promise<void> {
  const runtime = getRuntimeStatus();
  if (runtime.state === "running" || runtime.state === "starting" || runtime.state === "degraded") {
    console.error("  Stop jin before clearing the discovery cache.");
    process.exit(1);
  }

  const cachePath = discoveryCachePath();
  if (!existsSync(cachePath)) {
    console.log(`  No discovery cache found at ${cachePath}`);
    return;
  }

  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${cachePath}${suffix}`, { force: true });
  }
  console.log(`  Cleared discovery cache at ${cachePath}`);
}
