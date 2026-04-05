import { closeSync, openSync, writeFileSync } from "fs";
import { join } from "path";
import { configDir } from "../config";

const PID_FILE = join(configDir(), "jin.pid");
const LOG_FILE = join(configDir(), "jin.log");

export async function daemonize(): Promise<void> {
  let exe: string;
  try {
    const { realpathSync } = await import("fs");
    exe = realpathSync("/proc/self/exe");
  } catch {
    exe = process.execPath;
  }

  const isCompiled = !exe.endsWith("bun") && !exe.endsWith("node");
  const cmd = isCompiled
    ? [exe, "start", "--foreground"]
    : [exe, "run", process.argv[1], "start", "--foreground"];

  const logFd = openSync(LOG_FILE, "a");
  const proc = Bun.spawn(cmd, {
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    detached: true,
    env: { ...process.env, JIN_DAEMON: "1" },
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
