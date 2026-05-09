import * as readline from "readline";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir, platform, arch, tmpdir } from "os";
import { basename, dirname, join, win32 } from "path";
import { spawn, spawnSync } from "child_process";
import { configDir } from "../config";
import { VERSION } from "../updater";

const RELEASE_REPO = "mendeleden/jin";
const USER_AGENT = "jin-desktop-installer";

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface DesktopInstallMetadata {
  version: string;
  assetName: string;
  installPath: string;
  installedAt: string;
}

export interface DesktopRollbackState {
  previous: DesktopInstallMetadata;
  installRoot: string;
  rollbackRoot: string;
  savedAt: string;
}

export interface DesktopCommandOptions {
  yes?: boolean;
  update?: boolean;
  rollback?: boolean;
}

interface DesktopInstallPlan {
  action: "install" | "update";
  asset: GithubReleaseAsset;
  releaseTag: string;
  installPath: string;
  currentVersion?: string;
}

export async function desktopCommand(opts: DesktopCommandOptions = {}): Promise<void> {
  if (opts.rollback) {
    rollbackDesktopInstall();
    return;
  }

  const candidates = getDesktopAssetCandidates();
  if (candidates.length === 0) {
    console.error(`  Jin Desktop is not currently available for ${formatDesktopTarget()}.`);
    console.error(
      "  This release publishes Desktop for macOS arm64, macOS x64, Linux x64, and Windows x64.",
    );
    process.exit(1);
  }

  const existing = readDesktopInstallMetadata();

  if (existing && !opts.update) {
    console.log(`  Jin Desktop is installed at ${existing.installPath}`);
    launchDesktop(existing.installPath);
    return;
  }

  console.log("");
  console.log("  jin desktop");
  console.log(`  CLI: v${VERSION}`);
  console.log("");

  process.stdout.write("  Checking latest Desktop release...");
  const release = await fetchLatestRelease();
  process.stdout.write("\r\x1b[K");

  if (!release) {
    console.error("  Could not reach GitHub releases.");
    console.error(`  https://github.com/${RELEASE_REPO}/releases/latest`);
    process.exit(1);
  }

  const asset = selectDesktopReleaseAsset(release.assets);
  if (!asset) {
    console.error(`  No Desktop release asset found for ${platform()}-${arch()}.`);
    console.error("  Expected one of:");
    for (const candidate of candidates) {
      console.error(`    ${candidate}`);
    }
    console.error(`  Release: https://github.com/${RELEASE_REPO}/releases/tag/${release.tag_name}`);
    process.exit(1);
  }

  const latestVersion = normalizeVersion(release.tag_name);
  if (existing && normalizeVersion(existing.version) === latestVersion) {
    console.log(`  Jin Desktop is already on ${release.tag_name}.`);
    launchDesktop(existing.installPath);
    return;
  }

  const plan: DesktopInstallPlan = {
    action: existing ? "update" : "install",
    asset,
    releaseTag: release.tag_name,
    installPath: getDesktopInstallPath(asset.name),
    currentVersion: existing?.version,
  };

  if (!(await confirmDesktopInstall(plan, opts))) {
    console.log("  Cancelled.");
    return;
  }

  const archivePath = await downloadDesktopAsset(asset);
  try {
    const installPath = installDesktopArtifact(archivePath, asset.name, existing);
    writeDesktopInstallMetadata({
      version: release.tag_name,
      assetName: asset.name,
      installPath,
      installedAt: new Date().toISOString(),
    });
    console.log(`  Installed Jin Desktop ${release.tag_name} to ${installPath}`);
    launchDesktop(installPath);
  } finally {
    rmSync(archivePath, { force: true });
  }
}

export function getDesktopAssetCandidates(
  os: NodeJS.Platform = platform(),
  cpu: string = arch(),
): string[] {
  const normalizedArch = normalizeArch(cpu);

  if (os === "darwin") {
    if (normalizedArch === "arm64") {
      return ["jin-desktop-darwin-arm64.zip"];
    }
    return normalizedArch === "x64" ? ["jin-desktop-darwin-x64.zip"] : [];
  }

  if (os === "linux") {
    return normalizedArch === "x64" ? ["jin-desktop-linux-x64.tar.gz"] : [];
  }

  if (os === "win32") {
    return normalizedArch === "x64" ? ["jin-desktop-windows-x64.zip"] : [];
  }

  return [];
}

export function selectDesktopReleaseAsset(
  assets: GithubReleaseAsset[],
  os: NodeJS.Platform = platform(),
  cpu: string = arch(),
): GithubReleaseAsset | undefined {
  const candidates = getDesktopAssetCandidates(os, cpu).map((name) => name.toLowerCase());
  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    const exact = assets.find((asset) => asset.name.toLowerCase() === candidate);
    if (exact) {
      return exact;
    }
  }

  const osTokens = os === "darwin" ? ["darwin", "macos"] : os === "win32" ? ["windows", "win32"] : [os];
  const cpuToken = normalizeArch(cpu);
  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return (
      name.includes("desktop") &&
      osTokens.some((token) => name.includes(token)) &&
      name.includes(cpuToken) &&
      isSupportedDesktopArtifact(name)
    );
  });
}

export function formatDesktopBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "unknown size";
  }
  if (bytes >= 1_000_000_000) {
    return `${trimFixed(bytes / 1_000_000_000)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${trimFixed(bytes / 1_000_000)} MB`;
  }
  if (bytes >= 1_000) {
    return `${trimFixed(bytes / 1_000)} KB`;
  }
  return `${bytes} B`;
}

function metadataPath(): string {
  return join(configDir(), "desktop.json");
}

function rollbackStatePath(): string {
  return join(configDir(), "desktop.rollback.json");
}

function readDesktopInstallMetadata(): DesktopInstallMetadata | null {
  const path = metadataPath();
  if (existsSync(path)) {
    try {
      const metadata = JSON.parse(readFileSync(path, "utf8")) as DesktopInstallMetadata;
      if (metadata.installPath && existsSync(metadata.installPath)) {
        return metadata;
      }
    } catch {
      // Ignore corrupt metadata and fall back to the conventional install path.
    }
  }

  const defaultPath = getDefaultDesktopInstallPath();
  if (defaultPath && existsSync(defaultPath)) {
    return {
      version: "unknown",
      assetName: "unknown",
      installPath: defaultPath,
      installedAt: "",
    };
  }

  return null;
}

function writeDesktopInstallMetadata(metadata: DesktopInstallMetadata): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(metadataPath(), JSON.stringify(metadata, null, 2));
}

function readDesktopRollbackState(): DesktopRollbackState | null {
  const path = rollbackStatePath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as DesktopRollbackState;
    if (state.previous?.installPath && state.rollbackRoot && existsSync(state.rollbackRoot)) {
      return state;
    }
  } catch {
    // Ignore corrupt rollback metadata and report no usable rollback.
  }

  return null;
}

function writeDesktopRollbackState(state: DesktopRollbackState): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(rollbackStatePath(), JSON.stringify(state, null, 2));
}

function clearDesktopRollbackState(): void {
  rmSync(rollbackStatePath(), { force: true });
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as GithubRelease;
  } catch {
    return null;
  }
}

async function confirmDesktopInstall(
  plan: DesktopInstallPlan,
  opts: DesktopCommandOptions,
): Promise<boolean> {
  const size = formatDesktopBytes(plan.asset.size);
  const action = plan.action === "update" ? "Update" : "Install";
  const versionLine =
    plan.action === "update" && plan.currentVersion
      ? `${plan.currentVersion} -> ${plan.releaseTag}`
      : plan.releaseTag;

  console.log(`  ${action} Jin Desktop ${versionLine}`);
  console.log(`  Download: ${size}`);
  console.log(`  Target:   ${plan.installPath}`);
  console.log("");

  if (opts.yes) {
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error("  Refusing to install without confirmation on a non-interactive terminal.");
    console.error("  Re-run with `jin desktop --yes` to install without a prompt.");
    return false;
  }

  const answer = await ask(`  Continue? [y/N] `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

async function downloadDesktopAsset(asset: GithubReleaseAsset): Promise<string> {
  const archivePath = join(tmpdir(), `${Date.now()}-${basename(asset.name)}`);
  console.log(`  Downloading ${asset.name} (${formatDesktopBytes(asset.size)})...`);

  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    console.error(`  Download failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(archivePath, data);
  console.log(`  Downloaded ${formatDesktopBytes(data.byteLength)}.`);
  return archivePath;
}

function rollbackDesktopInstall(): void {
  const state = readDesktopRollbackState();
  if (!state) {
    console.log("  No Desktop rollback is available.");
    return;
  }

  const currentRoot = state.installRoot;
  const failedRoot = `${currentRoot}.failed`;

  try {
    rmSync(failedRoot, { recursive: true, force: true });
    if (existsSync(currentRoot)) {
      renameSync(currentRoot, failedRoot);
    }
    renameSync(state.rollbackRoot, currentRoot);
    writeDesktopInstallMetadata({
      ...state.previous,
      installedAt: new Date().toISOString(),
    });
    clearDesktopRollbackState();
    rmSync(failedRoot, { recursive: true, force: true });
    console.log(`  Rolled back Jin Desktop to ${state.previous.version}.`);
    launchDesktop(state.previous.installPath);
  } catch (err) {
    if (!existsSync(currentRoot) && existsSync(failedRoot)) {
      renameSync(failedRoot, currentRoot);
    }
    console.error(`  Desktop rollback failed: ${err}`);
    process.exit(1);
  }
}

function installDesktopArtifact(
  archivePath: string,
  assetName: string,
  previousMetadata: DesktopInstallMetadata | null,
): string {
  const targetPath = getDesktopInstallPath(assetName);
  const extractDir = mkdtempSync(join(tmpdir(), "jin-desktop-"));

  try {
    const lowerName = assetName.toLowerCase();

    if (platform() === "darwin" && lowerName.endsWith(".dmg")) {
      installMacDmg(archivePath, targetPath, previousMetadata);
      return targetPath;
    }

    if (lowerName.endsWith(".appimage")) {
      prepareDesktopRollback(targetPath, previousMetadata);
      try {
        const installRoot = getDesktopInstallRoot(targetPath);
        mkdirSync(dirname(installRoot), { recursive: true });
        copyFileSync(archivePath, installRoot);
        chmodSync(targetPath, 0o755);
      } catch (err) {
        restorePreparedDesktopRollback(targetPath);
        throw err;
      }
      return targetPath;
    }

    extractArchive(archivePath, assetName, extractDir);
    const sourcePath = findInstallableDesktopArtifact(extractDir);
    if (!sourcePath) {
      throw new Error(`No installable Desktop app found in ${assetName}`);
    }

    if (platform() === "darwin") {
      replaceDesktopInstallRoot(sourcePath, targetPath, previousMetadata);
    } else {
      replaceDesktopInstallRoot(dirname(sourcePath), targetPath, previousMetadata);
      chmodSync(targetPath, 0o755);
    }

    return targetPath;
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function installMacDmg(
  archivePath: string,
  targetPath: string,
  previousMetadata: DesktopInstallMetadata | null,
): void {
  const mountDir = mkdtempSync(join(tmpdir(), "jin-desktop-dmg-"));

  try {
    runCommand("hdiutil", ["attach", archivePath, "-nobrowse", "-quiet", "-mountpoint", mountDir]);
    const sourcePath = findInstallableDesktopArtifact(mountDir);
    if (!sourcePath) {
      throw new Error("No .app bundle found in Desktop disk image");
    }

    replaceDesktopInstallRoot(sourcePath, targetPath, previousMetadata);
  } finally {
    spawnSync("hdiutil", ["detach", mountDir, "-quiet"], { stdio: "pipe" });
    rmSync(mountDir, { recursive: true, force: true });
  }
}

function replaceDesktopInstallRoot(
  sourceRoot: string,
  targetPath: string,
  previousMetadata: DesktopInstallMetadata | null,
): void {
  const installRoot = getDesktopInstallRoot(targetPath);

  prepareDesktopRollback(targetPath, previousMetadata);
  try {
    mkdirSync(dirname(installRoot), { recursive: true });
    cpSync(sourceRoot, installRoot, { recursive: true });
  } catch (err) {
    restorePreparedDesktopRollback(targetPath);
    throw err;
  }
}

function prepareDesktopRollback(
  targetPath: string,
  previousMetadata: DesktopInstallMetadata | null,
): void {
  const installRoot = getDesktopInstallRoot(targetPath);
  const rollbackRoot = getDesktopRollbackRoot(targetPath);

  rmSync(rollbackRoot, { recursive: true, force: true });
  if (!existsSync(installRoot)) {
    rmSync(installRoot, { recursive: true, force: true });
    clearDesktopRollbackState();
    return;
  }

  renameSync(installRoot, rollbackRoot);
  try {
    writeDesktopRollbackState({
      previous:
        previousMetadata ??
        {
          version: "unknown",
          assetName: "unknown",
          installPath: targetPath,
          installedAt: "",
        },
      installRoot,
      rollbackRoot,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    renameSync(rollbackRoot, installRoot);
    throw err;
  }
}

function restorePreparedDesktopRollback(targetPath: string): void {
  const installRoot = getDesktopInstallRoot(targetPath);
  const rollbackRoot = getDesktopRollbackRoot(targetPath);

  rmSync(installRoot, { recursive: true, force: true });
  if (existsSync(rollbackRoot)) {
    renameSync(rollbackRoot, installRoot);
  }
  clearDesktopRollbackState();
}

function extractArchive(archivePath: string, assetName: string, extractDir: string): void {
  const lowerName = assetName.toLowerCase();

  if (lowerName.endsWith(".zip")) {
    if (platform() === "darwin") {
      runCommand("ditto", ["-x", "-k", archivePath, extractDir]);
      return;
    }
    if (platform() === "win32") {
      runCommand("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(extractDir)}' -Force`,
      ]);
      return;
    }
    runCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    return;
  }

  if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) {
    runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    return;
  }

  throw new Error(`Unsupported Desktop artifact: ${assetName}`);
}

function findInstallableDesktopArtifact(root: string): string | null {
  const entries = readdirSync(root);
  for (const entry of entries) {
    const path = join(root, entry);
    const stats = statSync(path);
    const lower = entry.toLowerCase();

    if (platform() === "darwin" && stats.isDirectory() && lower.endsWith(".app")) {
      return path;
    }
    if (platform() === "win32" && stats.isFile() && lower.endsWith(".exe")) {
      return path;
    }
    if (platform() === "linux" && stats.isFile() && (lower.includes("desktop") || lower.includes("jin"))) {
      return path;
    }

    if (stats.isDirectory()) {
      const nested = findInstallableDesktopArtifact(path);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function getDesktopInstallPath(assetName: string): string {
  if (platform() === "darwin") {
    return join(homedir(), "Applications", "Jin.app");
  }
  if (platform() === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "Jin", "Desktop", "Jin Desktop.exe");
  }

  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const suffix = assetName.toLowerCase().endsWith(".appimage") ? "Jin Desktop.AppImage" : "jin-desktop";
  return join(base, "jin", "desktop", suffix);
}

export function getDesktopInstallRoot(
  targetPath: string,
  os: NodeJS.Platform = platform(),
): string {
  if (os === "darwin") {
    return targetPath;
  }
  if (os === "linux" && targetPath.toLowerCase().endsWith(".appimage")) {
    return targetPath;
  }
  if (os === "win32") {
    return win32.dirname(targetPath);
  }
  return dirname(targetPath);
}

export function getDesktopRollbackRoot(
  targetPath: string,
  os: NodeJS.Platform = platform(),
): string {
  return `${getDesktopInstallRoot(targetPath, os)}.rollback`;
}

function getDefaultDesktopInstallPath(): string | null {
  const [candidate] = getDesktopAssetCandidates();
  return candidate ? getDesktopInstallPath(candidate) : null;
}

function launchDesktop(installPath: string): void {
  const child =
    platform() === "darwin"
      ? spawn("open", [installPath], { detached: true, stdio: "ignore" })
      : platform() === "win32"
        ? spawn("cmd", ["/c", "start", "", installPath], { detached: true, stdio: "ignore" })
        : spawn(installPath, [], { detached: true, stdio: "ignore" });

  child.unref();
  console.log("  Launching Jin Desktop.");
}

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const details = result.stderr || result.stdout || result.error?.message || "unknown error";
    throw new Error(`${command} failed: ${details.trim()}`);
  }
}

function isSupportedDesktopArtifact(name: string): boolean {
  return (
    name.endsWith(".zip") ||
    name.endsWith(".dmg") ||
    name.endsWith(".appimage") ||
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz")
  );
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/, "");
}

function normalizeArch(cpu: string): string {
  return cpu === "x64" || cpu === "amd64" ? "x64" : "arm64";
}

function formatDesktopTarget(os: NodeJS.Platform = platform(), cpu: string = arch()): string {
  return `${os}-${normalizeArch(cpu)}`;
}

function trimFixed(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''");
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
