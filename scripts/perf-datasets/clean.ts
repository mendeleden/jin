import {
  DEFAULT_OUTPUT_ROOT,
  cleanDatasets,
  isScaleTier,
  isScenarioName,
  listScenarioNames,
} from "./lib";

const args = process.argv.slice(2);
const parsed = parseCleanArgs(args);

if (!parsed.ok) {
  console.error(parsed.error);
  printUsage();
  process.exit(1);
}

const removed = cleanDatasets({
  outputRoot: parsed.outputRoot,
  scenario: parsed.scenario,
  scaleTier: parsed.scaleTier,
  all: parsed.all,
});

for (const path of removed) {
  console.log(`removed ${path}`);
}

if (removed.length === 0) {
  console.log("nothing to clean");
}

function parseCleanArgs(argv: string[]):
  | {
      ok: true;
      all: boolean;
      outputRoot?: string;
      scenario?: ReturnType<typeof listScenarioNames>[number];
      scaleTier?: "1x" | "10x" | "100x";
    }
  | {
      ok: false;
      error: string;
    } {
  let all = false;
  let outputRoot: string | undefined;
  let scenario: ReturnType<typeof listScenarioNames>[number] | undefined;
  let scaleTier: "1x" | "10x" | "100x" | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--scenario") {
      const value = argv[index + 1];
      if (!value || !isScenarioName(value)) {
        return { ok: false, error: `Unknown or missing --scenario value: ${value ?? "(missing)"}` };
      }
      scenario = value;
      index += 1;
      continue;
    }
    if (arg === "--scale") {
      const value = argv[index + 1];
      if (!value || !isScaleTier(value)) {
        return { ok: false, error: `Unknown or missing --scale value: ${value ?? "(missing)"}` };
      }
      scaleTier = value;
      index += 1;
      continue;
    }
    if (arg === "--output-root") {
      const value = argv[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --output-root" };
      }
      outputRoot = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (!all && !scenario) {
    return { ok: false, error: "Provide --all or at least --scenario." };
  }

  return {
    ok: true,
    all,
    outputRoot,
    scenario,
    scaleTier,
  };
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  bun scripts/perf-datasets/clean.ts --all",
      "  bun scripts/perf-datasets/clean.ts --scenario <scenario> [--scale <1x|10x|100x>]",
      "",
      `Default output root: ${DEFAULT_OUTPUT_ROOT}`,
    ].join("\n"),
  );
}
