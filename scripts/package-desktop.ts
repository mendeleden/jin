#!/usr/bin/env bun

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { arch, platform, tmpdir } from "os";
import { basename, join } from "path";
import { downloadArtifact } from "@electron/get";
import extractZip from "extract-zip";

const ROOT = join(import.meta.dir, "..");
const ELECTRON_DIST = join(ROOT, "node_modules", "electron", "dist");
const DESKTOP_DIST = join(ROOT, "desktop", "dist");
const DESKTOP_APP_ICON_ICNS = join(DESKTOP_DIST, "assets", "jin-app-icon.icns");
const ARTIFACT_DIR = join(ROOT, "release-artifacts");
const VERSION = readVersion();

const hostPlatform = platform();
const hostArch = normalizeArch(arch());
const target = parseTarget();
const artifactBase = `jin-desktop-${artifactPlatform(target.platform)}-${target.arch}`;
const supportedTargets = ["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"];

if (!supportedTargets.includes(target.id)) {
  fail(
    `Desktop packaging is currently supported only for ${supportedTargets.join(
      ", ",
    )}.`,
  );
}

if (target.platform !== hostPlatform) {
  fail(`Desktop target ${target.id} must be packaged on ${target.platform}, not ${hostPlatform}.`);
}

if (!existsSync(DESKTOP_DIST)) {
  fail("desktop/dist is missing. Run `bun run desktop:build` first.");
}

if (!existsSync(ELECTRON_DIST)) {
  fail("node_modules/electron/dist is missing. Run `bun install` first.");
}

rmSync(ARTIFACT_DIR, { recursive: true, force: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

const staging = join(tmpdir(), `jin-desktop-package-${Date.now()}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

try {
  const electronDist = await resolveElectronDist(staging, target);
  const artifact =
    target.platform === "darwin"
      ? packageDarwin(staging, electronDist)
      : target.platform === "win32"
        ? packageWindows(staging, electronDist)
        : packageLinux(staging, electronDist);

  console.log(`Packaged ${basename(artifact)}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

function packageDarwin(staging: string, electronDist: string): string {
  const sourceApp = join(electronDist, "Electron.app");
  const appPath = join(staging, "Jin.app");
  const resourcesPath = join(appPath, "Contents", "Resources");
  const artifactPath = join(ARTIFACT_DIR, `${artifactBase}.zip`);

  cpSync(sourceApp, appPath, { recursive: true });
  installRendererApp(resourcesPath);
  installMacAppIcon(resourcesPath);
  updateMacInfoPlist(join(appPath, "Contents", "Info.plist"));

  run("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    appPath,
    artifactPath,
  ]);

  return artifactPath;
}

function packageLinux(staging: string, electronDist: string): string {
  const appDir = join(staging, "Jin Desktop");
  const resourcesPath = join(appDir, "resources");
  const electronBinary = join(appDir, "electron");
  const jinBinary = join(appDir, "jin-desktop");
  const artifactPath = join(ARTIFACT_DIR, `${artifactBase}.tar.gz`);

  cpSync(electronDist, appDir, { recursive: true });
  if (existsSync(electronBinary)) {
    renameSync(electronBinary, jinBinary);
  }
  installRendererApp(resourcesPath);

  run("tar", ["-czf", artifactPath, "-C", staging, "Jin Desktop"]);
  return artifactPath;
}

function packageWindows(staging: string, electronDist: string): string {
  const appDir = join(staging, "Jin Desktop");
  const resourcesPath = join(appDir, "resources");
  const electronBinary = join(appDir, "electron.exe");
  const jinBinary = join(appDir, "Jin Desktop.exe");
  const artifactPath = join(ARTIFACT_DIR, `${artifactBase}.zip`);

  cpSync(electronDist, appDir, { recursive: true });
  if (existsSync(electronBinary)) {
    renameSync(electronBinary, jinBinary);
  }
  installRendererApp(resourcesPath);
  run("powershell", [
    "-NoLogo",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -LiteralPath '${escapePowerShellPath(appDir)}' -DestinationPath '${escapePowerShellPath(artifactPath)}' -Force`,
  ]);

  return artifactPath;
}

function installRendererApp(resourcesPath: string): void {
  const appPath = join(resourcesPath, "app");
  const defaultAsar = join(resourcesPath, "default_app.asar");

  rmSync(defaultAsar, { force: true });
  rmSync(appPath, { recursive: true, force: true });
  mkdirSync(appPath, { recursive: true });
  cpSync(DESKTOP_DIST, appPath, { recursive: true });
  writeFileSync(
    join(appPath, "package.json"),
    JSON.stringify(
      {
        name: "jin-desktop",
        version: VERSION,
        private: true,
        main: "main.js",
      },
      null,
      2,
    ),
  );
}

function installMacAppIcon(resourcesPath: string): void {
  if (!existsSync(DESKTOP_APP_ICON_ICNS)) {
    return;
  }

  cpSync(DESKTOP_APP_ICON_ICNS, join(resourcesPath, "jin-app-icon.icns"));
}

function updateMacInfoPlist(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  const replacements: Array<[RegExp, string]> = [
    [
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1Jin$2",
    ],
    [
      /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1Jin$2",
    ],
    [
      /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1com.jin.desktop$2",
    ],
    [
      /(<key>CFBundleIconFile<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1jin-app-icon$2",
    ],
  ];

  let plist = readFileSync(path, "utf8");
  for (const [pattern, replacement] of replacements) {
    plist = plist.replace(pattern, replacement);
  }
  writeFileSync(path, plist);
}

async function resolveElectronDist(
  staging: string,
  target: DesktopPackageTarget,
): Promise<string> {
  if (target.platform === hostPlatform && target.arch === hostArch) {
    return ELECTRON_DIST;
  }

  const zipPath = await downloadArtifact({
    version: readElectronVersion(),
    platform: target.platform,
    arch: target.arch,
    artifactName: "electron",
  });
  const extractPath = join(staging, `electron-${target.id}`);
  mkdirSync(extractPath, { recursive: true });
  await extractZip(zipPath, { dir: extractPath });
  return extractPath;
}

function run(command: string, args: string[]): void {
  const proc = Bun.spawnSync([command, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    const stdout = new TextDecoder().decode(proc.stdout).trim();
    fail(`${command} failed: ${stderr || stdout || `exit ${proc.exitCode}`}`);
  }
}

function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return String(packageJson.version || "0.0.0");
}

function readElectronVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "electron", "package.json"), "utf8"),
  );
  return String(packageJson.version);
}

interface DesktopPackageTarget {
  id: string;
  platform: NodeJS.Platform;
  arch: "arm64" | "x64";
}

function parseTarget(): DesktopPackageTarget {
  const raw =
    process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) ??
    process.env.JIN_DESKTOP_PACKAGE_TARGET ??
    `${artifactPlatform(hostPlatform)}-${hostArch}`;
  const [platformPart, archPart] = raw.split("-");
  if (!platformPart || !archPart) {
    fail(`Invalid Desktop package target "${raw}". Expected platform-arch.`);
  }
  const targetPlatform = parsePlatform(platformPart);
  const targetArch = normalizeArch(archPart);
  return {
    id: `${artifactPlatform(targetPlatform)}-${targetArch}`,
    platform: targetPlatform,
    arch: targetArch,
  };
}

function parsePlatform(value: string): NodeJS.Platform {
  if (value === "darwin" || value === "linux" || value === "win32") {
    return value;
  }
  if (value === "windows") {
    return "win32";
  }
  fail(`Unsupported Desktop package platform "${value}".`);
}

function artifactPlatform(os: NodeJS.Platform): string {
  if (os === "darwin") {
    return "darwin";
  }
  if (os === "win32") {
    return "windows";
  }
  return os;
}

function normalizeArch(cpu: string): "arm64" | "x64" {
  return cpu === "x64" || cpu === "amd64" ? "x64" : "arm64";
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
