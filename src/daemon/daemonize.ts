import { closeSync, openSync, writeFileSync } from "fs";
import { join } from "path";
import { configDir } from "../config";
import { resolveSelfCommand } from "../runtime/self-command";

const PID_FILE = join(configDir(), "jin.pid");
const LOG_FILE = join(configDir(), "jin.log");

export async function daemonize(opts: {
  writeDebugJsonl?: boolean;
} = {}): Promise<void> {
  const cmd = [
    ...resolveSelfCommand(),
    "start",
    "--foreground",
    ...(opts.writeDebugJsonl ? ["--write-debug-jsonl"] : []),
  ];

  const logFd = openSync(LOG_FILE, "a");
  const proc = Bun.spawn(cmd, {
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    detached: true,
    env: { ...process.env, JIN_DAEMON: "1" },
    // On Windows, suppress the console window for the detached daemon and any
    // children it later spawns; without this each Bun.spawn from the daemon
    // pops a conhost.exe window because the daemon has no inheritable console.
    windowsHide: true,
  });
  closeSync(logFd);

  await Bun.sleep(500);
  if (proc.exitCode !== null) {
    console.error("  Failed to start daemon. Check logs at:", LOG_FILE);
    process.exit(1);
  }

  writeFileSync(PID_FILE, String(proc.pid));
  console.log(`  jin daemon started (PID ${proc.pid})`);
  console.log(`  Logs: ${LOG_FILE}`);
  console.log("  Stop: jin stop");
  proc.unref();
}
