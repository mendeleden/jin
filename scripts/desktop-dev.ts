#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { DESKTOP_DEV_SERVER_URL_ENV } from "../desktop/entry";

const ROOT = join(import.meta.dir, "..");
const ELECTRON_BIN = join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

async function main(): Promise<void> {
  if (!existsSync(ELECTRON_BIN)) {
    throw new Error("Electron binary was not found. Run `bun install` first.");
  }

  await runBuild();

  const server = await createServer({
    configFile: join(ROOT, "vite.desktop.config.ts"),
  });
  await server.listen();

  const devServerUrl = resolveDevServerUrl(server.resolvedUrls?.local ?? []);
  console.log(`Desktop dev server: ${devServerUrl}`);

  const electron = Bun.spawn([ELECTRON_BIN, join(ROOT, "desktop", "dist", "main.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      [DESKTOP_DEV_SERVER_URL_ENV]: devServerUrl,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const shutdown = async () => {
    electron.kill();
    await server.close();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(143));
  });

  const exitCode = await electron.exited;
  await server.close();
  process.exit(exitCode);
}

async function runBuild(): Promise<void> {
  const build = Bun.spawn(["bun", "run", "scripts/build-desktop.ts"], {
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`Desktop build failed with exit code ${exitCode}.`);
  }
}

function resolveDevServerUrl(urls: string[]): string {
  const url =
    urls.find((candidate) => candidate.startsWith("http://127.0.0.1:")) ??
    urls.find((candidate) => candidate.startsWith("http://localhost:")) ??
    urls[0];

  if (!url) {
    throw new Error("Vite did not report a local dev server URL.");
  }

  return new URL("/desktop/index.dev.html", url).toString();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
