// Self-updater: checks GitHub releases and replaces the binary in-place.
// Runs on `jin update` or automatically when the daemon restarts.

import { existsSync, chmodSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, platform, arch } from "os";

const REPO = "mendeleden/jin";
const VERSION_FILE = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "jin",
  "version"
);

// Embedded at build time via package.json
export const VERSION = "0.1.0";

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function getPlatformArtifact(): string {
  const os = platform(); // "linux" | "darwin"
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

export async function checkForUpdate(): Promise<{
  available: boolean;
  current: string;
  latest: string;
  url?: string;
} | null> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { "User-Agent": "jin-updater" } }
    );
    if (!resp.ok) return null;

    const release: GithubRelease = await resp.json();
    const latest = release.tag_name.replace(/^v/, "");
    const artifactName = getPlatformArtifact();
    const asset = release.assets.find((a) => a.name === artifactName);

    return {
      available: isNewer(latest, VERSION),
      current: VERSION,
      latest,
      url: asset?.browser_download_url,
    };
  } catch {
    return null;
  }
}

export async function selfUpdate(opts?: { silent?: boolean }): Promise<boolean> {
  const log = opts?.silent ? () => {} : (msg: string) => console.log(`  ${msg}`);

  log(`Current version: ${VERSION}`);
  log("Checking for updates...");

  const check = await checkForUpdate();
  if (!check) {
    log("Could not reach GitHub. Skipping update.");
    return false;
  }

  if (!check.available) {
    log(`Already on latest (${VERSION}).`);
    return false;
  }

  if (!check.url) {
    log(`New version ${check.latest} available but no binary for this platform.`);
    log(`Download manually: https://github.com/${REPO}/releases/tag/v${check.latest}`);
    return false;
  }

  log(`Updating ${VERSION} -> ${check.latest}...`);

  try {
    // Download new binary
    const resp = await fetch(check.url);
    if (!resp.ok) {
      log(`Download failed: ${resp.status}`);
      return false;
    }

    const data = await resp.arrayBuffer();

    // Find current binary path
    const binPath = process.execPath;
    const tmpPath = binPath + ".update";
    const backupPath = binPath + ".bak";

    // Write new binary to temp location
    await Bun.write(tmpPath, data);
    chmodSync(tmpPath, 0o755);

    // Atomic-ish swap: rename current -> backup, rename new -> current
    if (existsSync(backupPath)) unlinkSync(backupPath);
    renameSync(binPath, backupPath);
    renameSync(tmpPath, binPath);

    // Write version marker
    const versionDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jin");
    await Bun.write(VERSION_FILE, check.latest);

    // Clean up backup
    try { unlinkSync(backupPath); } catch {}

    log(`Updated to ${check.latest}.`);
    return true;
  } catch (err) {
    log(`Update failed: ${err}`);
    return false;
  }
}
