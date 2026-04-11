import {
  DEFAULT_OUTPUT_ROOT,
  generateDataset,
  isScaleTier,
  isScenarioName,
  listScaleTiers,
  listScenarioNames,
} from "./lib";

const args = process.argv.slice(2);
const parsed = parseGenerateArgs(args);

if (!parsed.ok) {
  console.error(parsed.error);
  printUsage();
  process.exit(1);
}

const targets = parsed.all
  ? listScenarioNames().flatMap((scenario) =>
      listScaleTiers().map((scaleTier) => ({ scenario, scaleTier })),
    )
  : [{ scenario: parsed.scenario, scaleTier: parsed.scaleTier }];

for (const target of targets) {
  const result = await generateDataset({
    scenario: target.scenario,
    scaleTier: target.scaleTier,
    outputRoot: parsed.outputRoot,
  });

  console.log(
    [
      `generated ${target.scenario} ${target.scaleTier}`,
      `dataset: ${result.datasetRoot}`,
      `manifest: ${result.manifestPath}`,
      `totals: files=${result.manifest.totals.sourceFiles} refs=${result.manifest.totals.refs} compacted=${result.manifest.totals.compacted} spawned=${result.manifest.totals.spawned}`,
    ].join("\n"),
  );
}

function parseGenerateArgs(argv: string[]):
  | {
      ok: true;
      all: boolean;
      outputRoot?: string;
      scenario: ReturnType<typeof listScenarioNames>[number];
      scaleTier: ReturnType<typeof listScaleTiers>[number];
    }
  | {
      ok: false;
      error: string;
    } {
  let scenario = listScenarioNames()[0];
  let scaleTier = listScaleTiers()[0];
  let outputRoot: string | undefined;
  let all = false;

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

  if (!all && (!scenario || !scaleTier)) {
    return { ok: false, error: "Both --scenario and --scale are required unless --all is set." };
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
      "  bun scripts/perf-datasets/generate.ts --scenario <scenario> --scale <1x|10x|100x>",
      "  bun scripts/perf-datasets/generate.ts --all",
      "",
      `Default output root: ${DEFAULT_OUTPUT_ROOT}`,
      `Scenarios: ${listScenarioNames().join(", ")}`,
      `Scales: ${listScaleTiers().join(", ")}`,
    ].join("\n"),
  );
}
