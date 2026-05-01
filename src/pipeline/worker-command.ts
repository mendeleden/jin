import { existsSync } from "fs";
import { join } from "path";

export type WorkerOperation = "findChanged" | "loadConversation";

export interface WorkerCommandSelectionContext {
  adapterId: string;
  operation: WorkerOperation;
}

export interface WorkerCommandConfig {
  command: string[];
  resolveCommand?: (
    context: WorkerCommandSelectionContext,
  ) => string[] | null;
}

const CLAUDE_CODE_GO_WORKER_ENV = "JIN_EXPERIMENT_CLAUDE_CODE_WORKER";
const CLAUDE_CODE_GO_BINARY_ENV = "JIN_EXPERIMENT_CLAUDE_CODE_GO_BINARY";

export function selectWorkerCommand(
  config: WorkerCommandConfig,
  context: WorkerCommandSelectionContext,
): string[] {
  const resolved = config.resolveCommand?.(context);
  return resolved ?? config.command;
}

export function createExperimentWorkerResolver(
  log?: (message: string) => void,
): WorkerCommandConfig["resolveCommand"] {
  let warnedMissingBinary = false;
  let announcedGoWorker = false;

  return ({ adapterId, operation }) => {
    if (adapterId !== "claude-code" || operation !== "loadConversation") {
      return null;
    }

    const mode = String(process.env[CLAUDE_CODE_GO_WORKER_ENV] ?? "")
      .trim()
      .toLowerCase();
    if (mode !== "go") {
      return null;
    }

    const binaryPath =
      process.env[CLAUDE_CODE_GO_BINARY_ENV] ||
      join(process.cwd(), "tools", "parser-spike", "go-parser-bin");

    if (!existsSync(binaryPath)) {
      if (!warnedMissingBinary) {
        warnedMissingBinary = true;
        log?.(
          `Experimental Claude Code Go worker requested via ${CLAUDE_CODE_GO_WORKER_ENV}=go, but binary was not found at ${binaryPath}; falling back to TS worker.`,
        );
      }
      return null;
    }

    if (!announcedGoWorker) {
      announcedGoWorker = true;
      log?.(
        `Experimental Claude Code Go worker enabled for loadConversation via ${CLAUDE_CODE_GO_WORKER_ENV}=go (${binaryPath}). findChanged remains on the TS worker.`,
      );
    }

    return [binaryPath, "worker"];
  };
}
