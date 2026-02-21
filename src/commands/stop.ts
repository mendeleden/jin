import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { configDir } from "../config";

const PID_FILE = join(configDir(), "jin.pid");

export async function stopCommand(): Promise<void> {
  // Check if running as OS service
  const { isServiceActive, isServiceInstalled } = await import("../runguard");
  if (isServiceActive()) {
    console.log("  jin is running as an OS service.");
    console.log("  Use `jin service uninstall` to stop and remove the service,");
    console.log("  or manage it directly:");
    if (process.platform === "linux") {
      console.log("    systemctl --user stop jin.service");
    } else if (process.platform === "darwin") {
      console.log("    launchctl unload ~/Library/LaunchAgents/com.jin.agent.plist");
    }
    return;
  }

  if (!existsSync(PID_FILE)) {
    if (isServiceInstalled()) {
      console.log("  jin is not running, but OS service is installed (inactive).");
      console.log("  Use `jin service uninstall` to remove it.");
    } else {
      console.log("  jin is not running.");
    }
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());

  try {
    // Check if alive
    process.kill(pid, 0);

    // Send SIGTERM for graceful shutdown
    console.log(`  Stopping jin (PID ${pid})...`);
    process.kill(pid, "SIGTERM");

    // Wait for it to die (up to 5 seconds)
    for (let i = 0; i < 50; i++) {
      await Bun.sleep(100);
      try {
        process.kill(pid, 0);
      } catch {
        // Process is dead
        console.log("  Stopped.");
        cleanup();
        return;
      }
    }

    // Force kill if still alive
    console.log("  Force killing...");
    process.kill(pid, "SIGKILL");
    cleanup();
    console.log("  Killed.");
  } catch {
    console.log(`  Process ${pid} is not running. Cleaning up PID file.`);
    cleanup();
  }
}

function cleanup(): void {
  try { unlinkSync(PID_FILE); } catch {}
}
