import { expect, test } from "bun:test";
import {
  formatDesktopBytes,
  getDesktopAssetCandidates,
  getDesktopInstallRoot,
  getDesktopRollbackRoot,
  selectDesktopReleaseAsset,
  type GithubReleaseAsset,
} from "../src/commands/desktop";

test("desktop command prefers the exact platform desktop asset", () => {
  const assets = [
    asset("jin-darwin-arm64"),
    asset("jin-desktop-darwin-arm64.dmg"),
    asset("jin-desktop-darwin-arm64.zip"),
  ];

  const selected = selectDesktopReleaseAsset(assets, "darwin", "arm64");

  expect(selected?.name).toBe("jin-desktop-darwin-arm64.zip");
});

test("desktop command selects the macOS x64 desktop asset", () => {
  const assets = [
    asset("jin-desktop-darwin-arm64.zip"),
    asset("jin-desktop-darwin-x64.zip"),
  ];

  const selected = selectDesktopReleaseAsset(assets, "darwin", "x64");

  expect(selected?.name).toBe("jin-desktop-darwin-x64.zip");
});

test("desktop command does not select the core CLI artifact", () => {
  const assets = [
    asset("jin-darwin-arm64"),
    asset("jin-linux-x64"),
    asset("jin-windows-x64.exe"),
  ];

  expect(selectDesktopReleaseAsset(assets, "darwin", "arm64")).toBeUndefined();
});

test("desktop command selects the Windows x64 desktop asset", () => {
  const assets = [
    asset("jin-desktop-linux-x64.tar.gz"),
    asset("jin-desktop-windows-x64.zip"),
  ];

  const selected = selectDesktopReleaseAsset(assets, "win32", "x64");

  expect(selected?.name).toBe("jin-desktop-windows-x64.zip");
});

test("desktop command falls back to compatible desktop asset names", () => {
  const assets = [
    asset("Jin-Desktop-macos-arm64.zip"),
    asset("jin-darwin-arm64"),
  ];

  const selected = selectDesktopReleaseAsset(assets, "darwin", "arm64");

  expect(selected?.name).toBe("Jin-Desktop-macos-arm64.zip");
});

test("desktop command documents expected release asset names", () => {
  expect(getDesktopAssetCandidates("darwin", "arm64")).toEqual([
    "jin-desktop-darwin-arm64.zip",
  ]);
  expect(getDesktopAssetCandidates("darwin", "x64")).toEqual([
    "jin-desktop-darwin-x64.zip",
  ]);
  expect(getDesktopAssetCandidates("linux", "x64")).toEqual([
    "jin-desktop-linux-x64.tar.gz",
  ]);
  expect(getDesktopAssetCandidates("win32", "x64")).toEqual([
    "jin-desktop-windows-x64.zip",
  ]);
});

test("desktop command does not advertise unsupported first-release targets", () => {
  expect(getDesktopAssetCandidates("linux", "arm64")).toEqual([]);
  expect(getDesktopAssetCandidates("win32", "arm64")).toEqual([]);
});

test("desktop command does not select unsupported platform assets", () => {
  expect(
    selectDesktopReleaseAsset([asset("jin-desktop-darwin-arm64.zip")], "linux", "x64"),
  ).toBeUndefined();
});

test("desktop command formats install prompt byte sizes", () => {
  expect(formatDesktopBytes(109_000_000)).toBe("109 MB");
  expect(formatDesktopBytes(20_400_000)).toBe("20.4 MB");
  expect(formatDesktopBytes(undefined)).toBe("unknown size");
});

test("desktop command maps install roots for rollback state", () => {
  expect(getDesktopInstallRoot("/Users/dev/Applications/Jin.app", "darwin")).toBe(
    "/Users/dev/Applications/Jin.app",
  );
  expect(getDesktopRollbackRoot("/Users/dev/Applications/Jin.app", "darwin")).toBe(
    "/Users/dev/Applications/Jin.app.rollback",
  );
  expect(getDesktopInstallRoot("/home/dev/.local/share/jin/desktop/jin-desktop", "linux")).toBe(
    "/home/dev/.local/share/jin/desktop",
  );
  expect(
    getDesktopInstallRoot("/home/dev/.local/share/jin/desktop/Jin Desktop.AppImage", "linux"),
  ).toBe("/home/dev/.local/share/jin/desktop/Jin Desktop.AppImage");
  expect(
    getDesktopInstallRoot(
      "C:\\Users\\dev\\AppData\\Local\\Jin\\Desktop\\Jin Desktop.exe",
      "win32",
    ),
  ).toBe("C:\\Users\\dev\\AppData\\Local\\Jin\\Desktop");
  expect(
    getDesktopRollbackRoot(
      "C:\\Users\\dev\\AppData\\Local\\Jin\\Desktop\\Jin Desktop.exe",
      "win32",
    ),
  ).toBe(
    "C:\\Users\\dev\\AppData\\Local\\Jin\\Desktop.rollback",
  );
});

function asset(name: string): GithubReleaseAsset {
  return {
    name,
    browser_download_url: `https://example.com/${name}`,
    size: 109_000_000,
  };
}
