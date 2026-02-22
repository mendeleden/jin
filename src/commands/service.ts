import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { configDir } from "../config";

const PLATFORM = process.platform;
const HOME = process.env.HOME || process.env.USERPROFILE || "";

function getJinBinaryPath(): string {
  // For compiled binary, resolve real path
  try {
    const { realpathSync } = require("fs");
    return realpathSync("/proc/self/exe");
  } catch {}

  // macOS doesn't have /proc — use process.execPath
  if (process.execPath && !process.execPath.includes("bunfs")) {
    return process.execPath;
  }

  // Fallback: check common install locations
  const candidates = [
    join(HOME, ".local", "bin", "jin"),
    join(HOME, ".bun", "bin", "jin"),
    "/usr/local/bin/jin",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return process.execPath;
}

// ── Linux: systemd user service ──────────────────────────────────────

const SYSTEMD_DIR = join(HOME, ".config", "systemd", "user");
const SYSTEMD_UNIT = join(SYSTEMD_DIR, "jin.service");

function systemdUnit(binPath: string): string {
  return `[Unit]
Description=jin — conversation data pipeline for agentic coding tools
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=JIN_LAUNCHED_BY_SERVICE=1
ExecStart=${binPath} watch
Restart=on-failure
RestartSec=5s
StandardOutput=append:${join(configDir(), "jin.log")}
StandardError=append:${join(configDir(), "jin.log")}

[Install]
WantedBy=default.target
`;
}

async function linuxInstall(): Promise<void> {
  const binPath = getJinBinaryPath();
  console.log(`  Binary: ${binPath}`);

  if (!existsSync(SYSTEMD_DIR)) {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
  }

  writeFileSync(SYSTEMD_UNIT, systemdUnit(binPath));
  console.log(`  Wrote ${SYSTEMD_UNIT}`);

  // Reload, enable, start
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });

  run(["systemctl", "--user", "daemon-reload"]);
  run(["systemctl", "--user", "enable", "jin.service"]);
  run(["systemctl", "--user", "start", "jin.service"]);

  console.log(`  Service enabled and started.`);

  // Enable linger so it survives reboot without login
  const user = process.env.USER || process.env.LOGNAME || "";
  if (user) {
    const linger = run(["loginctl", "enable-linger", user]);
    if (linger.exitCode === 0) {
      console.log(`  Linger enabled for ${user} (survives reboot).`);
    } else {
      console.log(`  Note: Could not enable linger. Run manually:`);
      console.log(`    sudo loginctl enable-linger ${user}`);
    }
  }
}

async function linuxUninstall(): Promise<void> {
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });

  run(["systemctl", "--user", "stop", "jin.service"]);
  run(["systemctl", "--user", "disable", "jin.service"]);

  if (existsSync(SYSTEMD_UNIT)) {
    unlinkSync(SYSTEMD_UNIT);
    console.log(`  Removed ${SYSTEMD_UNIT}`);
  }

  run(["systemctl", "--user", "daemon-reload"]);
  console.log(`  Service uninstalled.`);
}

async function linuxStatus(): Promise<void> {
  const result = Bun.spawnSync(["systemctl", "--user", "is-active", "jin.service"], {
    stdout: "pipe",
  });
  const state = new TextDecoder().decode(result.stdout).trim();
  const installed = existsSync(SYSTEMD_UNIT);

  console.log(`  Installed:  ${installed ? "yes" : "no"}`);
  if (installed) {
    console.log(`  Unit file:  ${SYSTEMD_UNIT}`);
    console.log(`  State:      ${state}`);

    // Check linger
    const user = process.env.USER || "";
    const lingerFile = `/var/lib/systemd/linger/${user}`;
    console.log(`  Linger:     ${existsSync(lingerFile) ? "enabled" : "not enabled"}`);
  }

  console.log(`\n  Manage with:`);
  console.log(`    systemctl --user status jin.service`);
  console.log(`    journalctl --user -u jin.service -f`);
}

// ── macOS: launchd LaunchAgent ───────────────────────────────────────

const LAUNCHD_DIR = join(HOME, "Library", "LaunchAgents");
const LAUNCHD_PLIST = join(LAUNCHD_DIR, "com.jin.agent.plist");

function launchdPlist(binPath: string): string {
  const logDir = join(HOME, "Library", "Logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jin.agent</string>

    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>watch</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>${join(logDir, "jin.out.log")}</string>

    <key>StandardErrorPath</key>
    <string>${join(logDir, "jin.err.log")}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>JIN_LAUNCHED_BY_SERVICE</key>
        <string>1</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${HOME}</string>
</dict>
</plist>
`;
}

async function darwinInstall(): Promise<void> {
  const binPath = getJinBinaryPath();
  console.log(`  Binary: ${binPath}`);

  if (!existsSync(LAUNCHD_DIR)) {
    mkdirSync(LAUNCHD_DIR, { recursive: true });
  }

  writeFileSync(LAUNCHD_PLIST, launchdPlist(binPath));
  console.log(`  Wrote ${LAUNCHD_PLIST}`);

  // Load the agent
  const uid = Bun.spawnSync(["id", "-u"], { stdout: "pipe" });
  const uidStr = new TextDecoder().decode(uid.stdout).trim();

  // Try modern syntax first, fall back to legacy
  let result = Bun.spawnSync(
    ["launchctl", "bootstrap", `gui/${uidStr}`, LAUNCHD_PLIST],
    { stdout: "inherit", stderr: "inherit" }
  );

  if (result.exitCode !== 0) {
    result = Bun.spawnSync(
      ["launchctl", "load", "-w", LAUNCHD_PLIST],
      { stdout: "inherit", stderr: "inherit" }
    );
  }

  if (result.exitCode === 0) {
    console.log(`  Service loaded and will start at login.`);
  } else {
    console.log(`  Plist written. Load manually:`);
    console.log(`    launchctl load -w ${LAUNCHD_PLIST}`);
  }
}

async function darwinUninstall(): Promise<void> {
  const uid = Bun.spawnSync(["id", "-u"], { stdout: "pipe" });
  const uidStr = new TextDecoder().decode(uid.stdout).trim();

  // Try modern syntax first
  let result = Bun.spawnSync(
    ["launchctl", "bootout", `gui/${uidStr}/com.jin.agent`],
    { stdout: "inherit", stderr: "pipe" }
  );

  if (result.exitCode !== 0) {
    Bun.spawnSync(
      ["launchctl", "unload", "-w", LAUNCHD_PLIST],
      { stdout: "inherit", stderr: "inherit" }
    );
  }

  if (existsSync(LAUNCHD_PLIST)) {
    unlinkSync(LAUNCHD_PLIST);
    console.log(`  Removed ${LAUNCHD_PLIST}`);
  }

  console.log(`  Service uninstalled.`);
}

async function darwinStatus(): Promise<void> {
  const installed = existsSync(LAUNCHD_PLIST);
  console.log(`  Installed:  ${installed ? "yes" : "no"}`);

  if (installed) {
    console.log(`  Plist:      ${LAUNCHD_PLIST}`);

    const result = Bun.spawnSync(
      ["launchctl", "list"],
      { stdout: "pipe" }
    );
    const output = new TextDecoder().decode(result.stdout);
    const line = output.split("\n").find((l) => l.includes("com.jin.agent"));

    if (line) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[0] === "-" ? "not running" : `running (PID ${parts[0]})`;
      const lastExit = parts[1];
      console.log(`  State:      ${pid}`);
      console.log(`  Last exit:  ${lastExit}`);
    } else {
      console.log(`  State:      not loaded`);
    }

    console.log(`  Logs:       ~/Library/Logs/jin.out.log`);
  }
}

// ── Windows: Task Scheduler ──────────────────────────────────────────

async function windowsInstall(): Promise<void> {
  const binPath = getJinBinaryPath();
  console.log(`  Binary: ${binPath}`);

  const ps = [
    `$action = New-ScheduledTaskAction -Execute '${binPath}' -Argument 'watch'`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)`,
    `Register-ScheduledTask -TaskName 'jin' -Action $action -Trigger $trigger -Settings $settings -Description 'jin conversation data pipeline'`,
    `Start-ScheduledTask -TaskName 'jin'`,
  ].join("; ");

  const result = Bun.spawnSync(["powershell", "-Command", ps], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode === 0) {
    console.log(`  Task registered. jin will start at logon and restart on failure.`);
  } else {
    console.log(`  Failed to register task. Try running as administrator.`);
  }
}

async function windowsUninstall(): Promise<void> {
  const ps = [
    `Stop-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskName 'jin' -Confirm:$false`,
  ].join("; ");

  const result = Bun.spawnSync(["powershell", "-Command", ps], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode === 0) {
    console.log(`  Task unregistered.`);
  } else {
    console.log(`  Failed to unregister task.`);
  }
}

async function windowsStatus(): Promise<void> {
  const ps = `Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue | Format-List TaskName,State`;

  const result = Bun.spawnSync(["powershell", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = new TextDecoder().decode(result.stdout).trim();
  if (output) {
    console.log(`  ${output.replace(/\n/g, "\n  ")}`);
  } else {
    console.log(`  Installed:  no`);
  }
}

// ── Entry point ──────────────────────────────────────────────────────

async function stopExistingDaemon(): Promise<void> {
  const { isDaemonRunning } = await import("../runguard");
  const { running, pid } = isDaemonRunning();
  if (!running || !pid) return;

  console.log(`  Stopping existing daemon (PID ${pid}) before installing service...`);
  try {
    process.kill(pid, "SIGTERM");
    // Wait up to 3 seconds
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(100);
      try { process.kill(pid, 0); } catch { break; }
    }
  } catch {}

  // Clean up PID file
  const pidFile = join(configDir(), "jin.pid");
  try { unlinkSync(pidFile); } catch {}
  console.log(`  Daemon stopped.`);
}

export async function serviceCommand(action: string | undefined): Promise<void> {
  console.log(`\n  jin service — ${PLATFORM}\n`);

  switch (action) {
    case "install": {
      // Stop any running daemon/foreground instance first
      await stopExistingDaemon();

      if (PLATFORM === "linux") await linuxInstall();
      else if (PLATFORM === "darwin") await darwinInstall();
      else if (PLATFORM === "win32") await windowsInstall();
      else console.log(`  Unsupported platform: ${PLATFORM}`);
      break;
    }
    case "uninstall": {
      if (PLATFORM === "linux") await linuxUninstall();
      else if (PLATFORM === "darwin") await darwinUninstall();
      else if (PLATFORM === "win32") await windowsUninstall();
      else console.log(`  Unsupported platform: ${PLATFORM}`);
      break;
    }
    case "status": {
      if (PLATFORM === "linux") await linuxStatus();
      else if (PLATFORM === "darwin") await darwinStatus();
      else if (PLATFORM === "win32") await windowsStatus();
      else console.log(`  Unsupported platform: ${PLATFORM}`);
      break;
    }
    default: {
      console.log(`  Usage:`);
      console.log(`    jin service install     Register jin as OS service (survives reboot)`);
      console.log(`    jin service uninstall   Remove OS service registration`);
      console.log(`    jin service status      Check OS service status`);
      console.log(``);
      console.log(`  This is separate from \`jin watch --daemon\` which is a simple`);
      console.log(`  background process. \`jin service install\` registers with your`);
      console.log(`  OS service manager so jin auto-starts on boot/login.`);
      console.log(``);
      if (PLATFORM === "linux") {
        console.log(`  Platform: Linux (systemd user service)`);
        console.log(`  Unit:     ~/.config/systemd/user/jin.service`);
      } else if (PLATFORM === "darwin") {
        console.log(`  Platform: macOS (launchd LaunchAgent)`);
        console.log(`  Plist:    ~/Library/LaunchAgents/com.jin.agent.plist`);
      } else if (PLATFORM === "win32") {
        console.log(`  Platform: Windows (Task Scheduler)`);
        console.log(`  Task:     jin`);
      }
      console.log(``);
    }
  }
}
