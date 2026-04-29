// Reverse routing: resolve which Postgres sinks apply to the current working directory.
// Reuses matchesRoute() from routing.ts and project detection from tagger.ts.

import { execSync } from "child_process";
import type { JinConfig, PostgresSinkConfig } from "./config";
import { matchesRoute } from "./routing";

export interface ResolvedSink {
  sinkConfig: PostgresSinkConfig;
  sinkId: string;
  sinkName: string;
}

/** Extract a human-friendly project name from a cwd */
function projectNameFromCwd(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

/** Detect git remote origin URL from a directory */
function gitRemoteFromCwd(cwd: string): string | undefined {
  try {
    return execSync("git remote get-url origin", { cwd, timeout: 3000, stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Given the current working directory and config, determine which Postgres sinks
 * should be searched. Returns only sinks with type === "postgres".
 */
export function resolveSinksForCwd(cwd: string, config: JinConfig): ResolvedSink[] {
  if (!config.routes?.length) return [];

  const projectInfo = {
    id: "",
    name: projectNameFromCwd(cwd),
    directory: cwd,
    gitRemote: gitRemoteFromCwd(cwd),
  };

  for (const route of config.routes) {
    if (matchesRoute(route.match, projectInfo)) {
      return route.sinks
        .flatMap((sinkId) => {
          const sinkConfig = findPostgresSinkConfig(sinkId, config);
          if (!sinkConfig) return [];
          return [toResolvedSink(sinkConfig)];
        });
    }
  }

  // Check defaultSinks
  const defaults = config.defaultSinks || [];
  if (defaults.length > 0) {
    return defaults
      .flatMap((sinkId) => {
        const sinkConfig = findPostgresSinkConfig(sinkId, config);
        if (!sinkConfig) return [];
        return [toResolvedSink(sinkConfig)];
      });
  }

  return [];
}

/** Find a specific Postgres sink by ID */
export function findSinkById(sinkId: string, config: JinConfig): ResolvedSink | null {
  const sinkConfig = findPostgresSinkConfig(sinkId, config);
  return sinkConfig ? toResolvedSink(sinkConfig) : null;
}

/** Get all Postgres sinks from config */
export function allPostgresSinks(config: JinConfig): ResolvedSink[] {
  return config.sinks
    .flatMap((sinkConfig) =>
      sinkConfig.type === "postgres" ? [toResolvedSink(sinkConfig)] : [],
    );
}

function findPostgresSinkConfig(
  sinkId: string,
  config: JinConfig,
): PostgresSinkConfig | null {
  const sinkConfig = config.sinks.find(
    (s) => (s.id || `${s.type}-0`) === sinkId,
  );
  return sinkConfig?.type === "postgres" ? sinkConfig : null;
}

function toResolvedSink(sinkConfig: PostgresSinkConfig): ResolvedSink {
  return {
    sinkConfig,
    sinkId: sinkConfig.id || `${sinkConfig.type}-0`,
    sinkName: sinkConfig.name || sinkConfig.id || "postgres",
  };
}
