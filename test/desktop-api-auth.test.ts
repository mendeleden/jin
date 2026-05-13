import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDesktopApiToken } from "../src/api/auth";
import { removeTestDir } from "./helpers";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

test("desktop API auth repairs broad existing token permissions", () => {
  const previousConfigDir = process.env.JIN_CONFIG_DIR;
  const dir = mkdtempSync(join(tmpdir(), "jin-desktop-auth-"));
  process.env.JIN_CONFIG_DIR = dir;
  cleanup = () => {
    if (previousConfigDir) {
      process.env.JIN_CONFIG_DIR = previousConfigDir;
    } else {
      delete process.env.JIN_CONFIG_DIR;
    }
    removeTestDir(dir);
  };

  mkdirSync(dir, { recursive: true });
  const tokenPath = join(dir, "desktop-api-token");
  writeFileSync(tokenPath, "legacy-token\n", { mode: 0o644 });

  if (process.platform !== "win32") {
    chmodSync(tokenPath, 0o644);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o644);
  }

  expect(getDesktopApiToken()).toBe("legacy-token");

  if (process.platform !== "win32") {
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
  }
});
