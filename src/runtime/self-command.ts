import { resolve } from "path";

export function resolveSelfCommand(): string[] {
  const scriptPath = process.argv[1];
  if (
    typeof scriptPath === "string" &&
    (scriptPath.endsWith(".ts") ||
      scriptPath.endsWith(".js") ||
      scriptPath.endsWith(".tsx") ||
      scriptPath.endsWith(".jsx"))
  ) {
    return [process.execPath, resolve(scriptPath)];
  }

  return [process.execPath];
}
