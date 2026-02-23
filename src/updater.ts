// Self-updater: checks GitHub releases, replaces binary in-place,
// restarts daemon/service if running, keeps one rollback version.

import { existsSync, chmodSync, renameSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, platform, arch } from "os";
import { configDir } from "./config";

const REPO = "mendeleden/jin";
const PID_FILE = join(configDir(), "jin.pid");
const BACKUP_PATH_FILE = join(configDir(), "jin.bak.path");

// Embedded at build time — bump in package.json
export const VERSION = "0.1.4";

interface GithubRelease {
  tag_name: string;
  body: string; // release notes (markdown)
  assets: Array<{ name: string; browser_download_url: string }>;
}

function getPlatformArtifact(): string {
  const os = platform();
  const cpu = arch() === "arm64" ? "arm64" : "x64";
  return `jin-${os}-${cpu}`;
}

function parseVersion(tag: string): number[] {
  return tag.replace(/^v/, "").split(".").map(Number);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

/** Fetch the latest release metadata from GitHub */
async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { "User-Agent": "jin-updater" } }
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Format release notes into a concise changelog */
function formatChangelog(body: string): string {
  if (!body) return "";
  // Take first ~10 lines, strip markdown headers, trim
  const lines = body.split("\n")
    .map(l => l.replace(/^#+\s*/, "").trim())
    .filter(l => l.length > 0)
    .slice(0, 10);
  return lines.map(l => `    ${l}`).join("\n");
}

export async function checkForUpdate(): Promise<{
  available: boolean;
  current: string;
  latest: string;
  url?: string;
  changelog?: string;
} | null> {
  const release = await fetchLatestRelease();
  if (!release) return null;

  const latest = release.tag_name.replace(/^v/, "");
  const artifactName = getPlatformArtifact();
  const asset = release.assets.find((a) => a.name === artifactName);

  return {
    available: isNewer(latest, VERSION),
    current: VERSION,
    latest,
    url: asset?.browser_download_url,
    changelog: release.body || "",
  };
}

/** Detect how jin is currently running */
function detectRunState(): "service" | "daemon" | "none" {
  // Check OS service
  try {
    if (platform() === "linux") {
      const r = Bun.spawnSync(["systemctl", "--user", "is-active", "jin.service"], { stdout: "pipe", stderr: "pipe" });
      const state = new TextDecoder().decode(r.stdout).trim();
      if (state === "active" || state === "activating") return "service";
    }
    if (platform() === "darwin") {
      const r = Bun.spawnSync(["launchctl", "list"], { stdout: "pipe" });
      const out = new TextDecoder().decode(r.stdout);
      const line = out.split("\n").find(l => l.includes("com.jin.agent"));
      if (line && line.trim().split(/\s+/)[0] !== "-") return "service";
    }
  } catch {}

  // Check daemon PID
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
      process.kill(pid, 0); // throws if dead
      return "daemon";
    } catch {}
  }

  return "none";
}

/** Restart the daemon or service after update */
async function restartRunning(mode: "service" | "daemon", log: (msg: string) => void): Promise<void> {
  if (mode === "service") {
    log("Restarting service...");
    if (platform() === "linux") {
      Bun.spawnSync(["systemctl", "--user", "restart", "jin.service"], { stdout: "inherit", stderr: "inherit" });
    } else if (platform() === "darwin") {
      const plist = join(homedir(), "Library", "LaunchAgents", "com.jin.agent.plist");
      // kickstart sends SIGTERM then re-launches
      const r = Bun.spawnSync(["launchctl", "kickstart", "-k", `gui/${process.getuid?.() || 501}/com.jin.agent`], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) {
        // Fallback: unload + load
        Bun.spawnSync(["launchctl", "unload", plist], { stdout: "pipe", stderr: "pipe" });
        await Bun.sleep(500);
        Bun.spawnSync(["launchctl", "load", plist], { stdout: "pipe", stderr: "pipe" });
      }
    }
    log("Service restarted.");
    return;
  }

  if (mode === "daemon") {
    // Stop old daemon
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
      log(`Stopping daemon (PID ${pid})...`);
      process.kill(pid, "SIGTERM");
      // Wait for it to die
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(100);
        try { process.kill(pid, 0); } catch { break; }
      }
    } catch {}

    // Start new daemon
    log("Starting new daemon...");
    const binPath = process.execPath;
    const logFd = require("fs").openSync(join(configDir(), "jin.log"), "a");
    const proc = Bun.spawn([binPath, "watch"], {
      stdout: logFd,
      stderr: logFd,
      stdin: "ignore",
      env: { ...process.env },
    });
    require("fs").closeSync(logFd);

    await Bun.sleep(500);
    if (proc.exitCode !== null) {
      log("Warning: daemon failed to start. Check `jin status`.");
    } else {
      const { writeFileSync } = require("fs");
      writeFileSync(PID_FILE, String(proc.pid));
      proc.unref();
      log(`Daemon restarted (PID ${proc.pid}).`);
    }
  }
}

// ANSI helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bgBlue: "\x1b[44m",
  white: "\x1b[37m",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function progressBar(pct: number, width = 30): string {
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = `${c.cyan}${"█".repeat(filled)}${c.dim}${"░".repeat(empty)}${c.reset}`;
  return bar;
}

export async function selfUpdate(): Promise<boolean> {
  const log = (msg: string) => console.log(`  ${msg}`);

  console.log("");
  log(`${c.blue}${c.bold}jin${c.reset} ${c.dim}self-update${c.reset}`);
  log(`${c.dim}current  ${c.reset}${c.cyan}v${VERSION}${c.reset}  ${c.dim}(${getPlatformArtifact()})${c.reset}`);
  console.log("");

  // Check phase
  process.stdout.write(`  ${c.dim}checking github...${c.reset}`);
  const check = await checkForUpdate();
  process.stdout.write("\r\x1b[K"); // clear line

  if (!check) {
    log(`${c.red}✗${c.reset} Could not reach GitHub.`);
    return false;
  }

  if (!check.available) {
    log(`${c.green}✓${c.reset} Already on latest ${c.cyan}v${VERSION}${c.reset}`);
    console.log("");
    return false;
  }

  if (!check.url) {
    log(`${c.yellow}!${c.reset} ${c.bold}v${check.latest}${c.reset} available but no binary for ${getPlatformArtifact()}`);
    log(`${c.dim}  https://github.com/${REPO}/releases/tag/v${check.latest}${c.reset}`);
    return false;
  }

  // Version banner
  log(`${c.green}✓${c.reset} Update available`);
  console.log("");
  log(`  ${c.dim}${VERSION}${c.reset}  ${c.yellow}→${c.reset}  ${c.green}${c.bold}${check.latest}${c.reset}`);
  console.log("");

  // Changelog
  if (check.changelog) {
    const lines = check.changelog.split("\n")
      .map(l => l.replace(/^#+\s*/, "").trim())
      .filter(l => l.length > 0)
      .slice(0, 10);
    if (lines.length > 0) {
      log(`${c.dim}─── changelog ───${c.reset}`);
      for (const line of lines) {
        log(`${c.dim}  ${line}${c.reset}`);
      }
      log(`${c.dim}─────────────────${c.reset}`);
      console.log("");
    }
  }

  // Download with progress
  const artifact = getPlatformArtifact();
  log(`${c.cyan}↓${c.reset} Downloading ${c.bold}${artifact}${c.reset}`);

  const startTime = Date.now();
  const resp = await fetch(check.url);
  if (!resp.ok) {
    log(`${c.red}✗${c.reset} Download failed: ${resp.status}`);
    return false;
  }

  const contentLength = parseInt(resp.headers.get("content-length") || "0");
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (resp.body) {
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        const pct = received / contentLength;
        const bar = progressBar(pct);
        process.stdout.write(
          `\r  ${bar} ${c.bold}${(pct * 100).toFixed(0)}%${c.reset} ${c.dim}${formatBytes(received)} / ${formatBytes(contentLength)}${c.reset}`
        );
      } else {
        process.stdout.write(`\r  ${c.dim}${formatBytes(received)} downloaded...${c.reset}`);
      }
    }
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write("\r\x1b[K"); // clear progress line

  // Combine chunks
  const totalSize = chunks.reduce((a, c) => a + c.length, 0);
  const data = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }

  const speed = totalSize / (parseFloat(elapsed) || 1);
  log(`${c.green}✓${c.reset} Downloaded ${c.bold}${formatBytes(totalSize)}${c.reset} in ${c.cyan}${elapsed}s${c.reset} ${c.dim}(${formatBytes(speed)}/s)${c.reset}`);

  // Install phase
  const binPath = process.execPath;
  const tmpPath = binPath + ".update";
  const backupPath = binPath + ".bak";

  try {
    process.stdout.write(`  ${c.dim}installing...${c.reset}`);

    await Bun.write(tmpPath, data);
    chmodSync(tmpPath, 0o755);

    if (existsSync(backupPath)) {
      try { require("fs").unlinkSync(backupPath); } catch {}
    }
    renameSync(binPath, backupPath);
    renameSync(tmpPath, binPath);

    await Bun.write(BACKUP_PATH_FILE, backupPath);

    process.stdout.write("\r\x1b[K");
    log(`${c.green}✓${c.reset} Installed to ${c.dim}${binPath}${c.reset}`);
    log(`${c.dim}  rollback: ${c.reset}${c.yellow}jin rollback${c.reset}`);
  } catch (err) {
    process.stdout.write("\r\x1b[K");
    log(`${c.red}✗${c.reset} Install failed: ${err}`);
    if (existsSync(backupPath) && !existsSync(binPath)) {
      renameSync(backupPath, binPath);
      log(`${c.yellow}↩${c.reset} Restored previous version.`);
    }
    return false;
  }

  // Auto-restart
  const runState = detectRunState();
  if (runState !== "none") {
    console.log("");
    await restartRunning(runState, log);
  }

  console.log("");
  log(`${c.green}${c.bold}✓ jin v${check.latest} ready${c.reset}`);
  console.log("");

  return true;
}

/** Rollback to the previous version */
export async function rollback(): Promise<boolean> {
  const log = (msg: string) => console.log(`  ${msg}`);

  const binPath = process.execPath;
  const backupPath = binPath + ".bak";

  if (!existsSync(backupPath)) {
    log("No rollback available. Only one previous version is kept.");
    return false;
  }

  log(`Rolling back to previous version...`);

  try {
    const tmpPath = binPath + ".rollback-tmp";
    renameSync(binPath, tmpPath);
    renameSync(backupPath, binPath);
    renameSync(tmpPath, backupPath); // old "new" becomes the backup now

    log("Rolled back.");

    // Restart if running
    const runState = detectRunState();
    if (runState !== "none") {
      console.log("");
      await restartRunning(runState, log);
    }

    return true;
  } catch (err) {
    log(`Rollback failed: ${err}`);
    return false;
  }
}
