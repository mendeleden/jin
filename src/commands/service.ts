import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { configDir } from "../config";
import { stopWatcher } from "../daemon/process-state";
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../contracts/lifecycle";
import {
  clearRuntimeState,
  getRuntimeStatus,
  markRuntimeRunning,
  markRuntimeStarting,
} from "../daemon/runtime-state";
import {
  WINDOWS_TASK_FOLDER_NAME,
  windowsTaskIdentityPowerShellLines,
  windowsTaskReferenceForDocs,
} from "../windows-task";

const PLATFORM = process.platform;
const HOME = process.env.HOME || process.env.USERPROFILE || "";

interface ServiceInstallOptions {
  writeDebugJsonl?: boolean;
}

function serviceStartArgs(opts: ServiceInstallOptions = {}): string[] {
  return [
    "start",
    "--foreground",
    ...(opts.writeDebugJsonl ? ["--write-debug-jsonl"] : []),
  ];
}

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
  const isWin = process.platform === "win32";
  const bin = isWin ? "jin.exe" : "jin";
  const candidates = isWin
    ? [
        join(HOME, ".local", "bin", bin),
        join(process.env.LOCALAPPDATA || "", "jin", bin),
        join(process.env.PROGRAMFILES || "", "jin", bin),
      ]
    : [
        join(HOME, ".local", "bin", bin),
        join(HOME, ".bun", "bin", bin),
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

function systemdUnit(binPath: string, opts: ServiceInstallOptions = {}): string {
  const args = serviceStartArgs(opts).join(" ");
  return `[Unit]
Description=jin — conversation data pipeline for agentic coding tools
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=JIN_LAUNCHED_BY_SERVICE=1
ExecStart=${binPath} ${args}
Restart=on-failure
RestartSec=5s
StandardOutput=append:${join(configDir(), "jin.log")}
StandardError=append:${join(configDir(), "jin.log")}

# Resource limits — keep jin cooperative without a fixed RSS kill threshold
MemoryHigh=200M
CPUQuota=10%
TasksMax=20

[Install]
WantedBy=default.target
`;
}

async function linuxInstall(opts: ServiceInstallOptions = {}): Promise<void> {
  const binPath = getJinBinaryPath();
  console.log(`  Binary: ${binPath}`);

  if (!existsSync(SYSTEMD_DIR)) {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
  }

  writeFileSync(SYSTEMD_UNIT, systemdUnit(binPath, opts));
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

function launchdPlist(binPath: string, opts: ServiceInstallOptions = {}): string {
  const logDir = join(HOME, "Library", "Logs");
  const extraArgs = opts.writeDebugJsonl
    ? "        <string>--write-debug-jsonl</string>\n"
    : "";
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
        <string>start</string>
        <string>--foreground</string>
${extraArgs}
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

    <key>ProcessType</key>
    <string>Background</string>

    <key>Nice</key>
    <integer>10</integer>
</dict>
</plist>
`;
}

async function darwinInstall(opts: ServiceInstallOptions = {}): Promise<void> {
  const binPath = getJinBinaryPath();
  console.log(`  Binary: ${binPath}`);

  if (!existsSync(LAUNCHD_DIR)) {
    mkdirSync(LAUNCHD_DIR, { recursive: true });
  }

  writeFileSync(LAUNCHD_PLIST, launchdPlist(binPath, opts));
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

async function windowsInstall(opts: ServiceInstallOptions = {}): Promise<void> {
  const binPath = getJinBinaryPath();
  const args = serviceStartArgs(opts).join(" ");
  console.log(`  Binary: ${binPath}`);

  // Register a per-user task so installation doesn't require admin rights.
  // - whoami: full DOMAIN\user (or COMPUTERNAME\user) identity for the principal
  // - trigger -User: only fires on this user's logon, not at any logon
  // - principal LogonType=Interactive + RunLevel=Limited: runs unelevated as
  //   the current user; no stored password, no UAC.
  // - Register -Force: idempotent re-install overwrites a prior registration.
  const ps = [
    `$ErrorActionPreference = 'Stop'`,
    `$me = (whoami)`,
    ...windowsTaskIdentityPowerShellLines(),
    `$schedule = New-Object -ComObject 'Schedule.Service'`,
    `$schedule.Connect()`,
    `try { $null = $schedule.GetFolder($taskPath) } catch { $null = $schedule.GetFolder('\\').CreateFolder('${WINDOWS_TASK_FOLDER_NAME}') }`,
    `$action = New-ScheduledTaskAction -Execute '${binPath}' -Argument '${args}'`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $me`,
    `$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)`,
    `Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'jin conversation data pipeline' -Force | Out-Null`,
    `Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName`,
  ].join("; ");

  const result = Bun.spawnSync(
    ["powershell", "-NoLogo", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
    {
      stdout: "inherit",
      stderr: "inherit",
      windowsHide: true,
    },
  );

  if (result.exitCode === 0) {
    console.log(`  Task registered. jin will start at logon and restart on failure.`);
  } else {
    console.log(`  Failed to register task.`);
    console.log(`  jin registers a per-user task and should not require administrator rights.`);
    console.log(`  If the error mentions a Group Policy restriction on Task Scheduler,`);
    console.log(`  ask your admin to allow user-scheduled tasks for your account.`);
  }
}

async function windowsUninstall(): Promise<void> {
  const ps = [
    ...windowsTaskIdentityPowerShellLines(),
    `Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue`,
  ].join("; ");

  const result = Bun.spawnSync(
    ["powershell", "-NoLogo", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
    {
      stdout: "inherit",
      stderr: "inherit",
      windowsHide: true,
    },
  );

  if (result.exitCode === 0) {
    console.log(`  Task unregistered.`);
  } else {
    console.log(`  Failed to unregister task.`);
  }
}

async function windowsStatus(): Promise<void> {
  const ps = [
    ...windowsTaskIdentityPowerShellLines(),
    `Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue | Format-List TaskPath,TaskName,State`,
  ].join("; ");

  const result = Bun.spawnSync(
    ["powershell", "-NoLogo", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
    {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  );

  const output = new TextDecoder().decode(result.stdout).trim();
  if (output) {
    console.log(`  ${output.replace(/\n/g, "\n  ")}`);
  } else {
    console.log(`  Installed:  no`);
  }
}

// ── Entry point ──────────────────────────────────────────────────────

async function stopExistingRuntimeForServiceInstall(): Promise<boolean> {
  const runtime = getRuntimeStatus();
  if (!runtime.owner || runtime.owner.mode === "service") {
    return true;
  }

  console.log(`  Stopping existing runtime (PID ${runtime.owner.pid}) before installing service...`);
  const result = await stopWatcher({
    waitForExitMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
    forceAfterTimeout: true,
  });
  if (!result.completed) {
    console.log("  The existing runtime is still stopping.");
    console.log("  Wait for `jin status` to report `stopped`, then try again.");
    return false;
  }

  console.log(`  Existing runtime stopped.`);
  return true;
}

export async function serviceCommand(
  action: string | undefined,
  opts: ServiceInstallOptions = {},
): Promise<void> {
  console.log(`\n  jin service — ${PLATFORM}\n`);

  switch (action) {
    case "install": {
      const canInstall = await stopExistingRuntimeForServiceInstall();
      if (!canInstall) {
        return;
      }

      markRuntimeStarting("service");

      if (PLATFORM === "linux") await linuxInstall(opts);
      else if (PLATFORM === "darwin") await darwinInstall(opts);
      else if (PLATFORM === "win32") await windowsInstall(opts);
      else console.log(`  Unsupported platform: ${PLATFORM}`);

      await Bun.sleep(250);
      markRuntimeRunning("service");
      break;
    }
    case "uninstall": {
      if (PLATFORM === "linux") await linuxUninstall();
      else if (PLATFORM === "darwin") await darwinUninstall();
      else if (PLATFORM === "win32") await windowsUninstall();
      else console.log(`  Unsupported platform: ${PLATFORM}`);
      clearRuntimeState();
      break;
    }
    case "status": {
      if (PLATFORM === "linux") await linuxStatus();
      else if (PLATFORM === "darwin") await darwinStatus();
      else if (PLATFORM === "win32") await windowsStatus();
      else console.log(`  Unsupported platform: ${PLATFORM}`);

      const runtime = getRuntimeStatus();
      if (runtime.owner?.mode === "service") {
        console.log(``);
        console.log(`  Runtime owner: service manager (PID ${runtime.owner.pid})`);
        console.log(`  State:         ${runtime.state}`);
      }
      break;
    }
    default: {
      console.log(`  Usage:`);
      console.log(`    jin service install     Register jin as OS service (survives reboot)`);
      console.log(`    jin service uninstall   Remove OS service registration`);
      console.log(`    jin service status      Check OS service status`);
      console.log(``);
      console.log(`  This is separate from \`jin start\` which is a simple`);
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
        console.log(`  Task:     ${windowsTaskReferenceForDocs()}`);
      }
      console.log(``);
    }
  }
}
