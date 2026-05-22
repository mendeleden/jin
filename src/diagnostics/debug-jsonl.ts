import { join } from "path";
import { configDir as defaultConfigDir } from "../config";

export const WRITE_DEBUG_JSONL_FLAG = "write-debug-jsonl";

export interface DebugJsonlPolicyOptions {
  enabled?: boolean;
  configDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveDebugJsonlPath(
  options: DebugJsonlPolicyOptions = {},
): string | undefined {
  if (!options.enabled) {
    return undefined;
  }

  const env = options.env ?? process.env;
  return (
    env.JIN_DIAGNOSTIC_LOG ||
    join(options.configDir ?? defaultConfigDir(), "debug.jsonl")
  );
}
