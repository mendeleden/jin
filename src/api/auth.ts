import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "path";
import { configDir } from "../config";

export const DESKTOP_AUTH_HEADER = "x-jin-desktop-token";

const TOKEN_FILE = "desktop-api-token";
const TOKEN_BYTES = 32;

export function getDesktopApiToken(): string {
  const existing = readDesktopApiToken();
  if (existing) {
    return existing;
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  writeDesktopApiToken(token);
  return token;
}

export function isAuthorizedDesktopRequest(
  request: Request,
  token: string,
): boolean {
  const presented = readPresentedToken(request);
  if (!presented) {
    return false;
  }
  return secureEqual(presented, token);
}

function readDesktopApiToken(): string | null {
  const path = tokenPath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const token = readFileSync(path, "utf-8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function writeDesktopApiToken(token: string): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(tokenPath(), `${token}\n`, { mode: 0o600 });
}

function tokenPath(): string {
  return join(configDir(), TOKEN_FILE);
}

function readPresentedToken(request: Request): string | null {
  const headerToken = request.headers.get(DESKTOP_AUTH_HEADER);
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
