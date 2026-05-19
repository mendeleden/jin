import { join } from "node:path";

export const DESKTOP_DEV_SERVER_URL_ENV = "JIN_DESKTOP_DEV_SERVER_URL";

export type DesktopEntry =
  | {
      kind: "dev-server";
      url: string;
    }
  | {
      kind: "file";
      filePath: string;
    };

export function resolveDesktopEntry(
  currentDir: string,
  env: Record<string, string | undefined> = process.env,
): DesktopEntry {
  const devServerUrl = normalizeDesktopDevServerUrl(
    env[DESKTOP_DEV_SERVER_URL_ENV],
  );

  if (devServerUrl) {
    return {
      kind: "dev-server",
      url: devServerUrl,
    };
  }

  return {
    kind: "file",
    filePath: join(currentDir, "index.html"),
  };
}

export function normalizeDesktopDevServerUrl(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value);
  if (url.protocol !== "http:") {
    throw new Error("Desktop dev server URL must use http.");
  }

  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Desktop dev server URL must point at localhost.");
  }

  return url.toString();
}
