import { DEFAULT_OUTPUT_ROOT, validateDataset, walkGeneratedDatasetRoots } from "./validate_helpers";

const args = process.argv.slice(2);
const parsed = parseValidateArgs(args);

if (!parsed.ok) {
  console.error(parsed.error);
  printUsage();
  process.exit(1);
}

const datasetRoots = parsed.all ? walkGeneratedDatasetRoots(parsed.outputRoot) : [parsed.dataset];

if (datasetRoots.length === 0) {
  console.error(`No generated datasets found under ${parsed.outputRoot}`);
  process.exit(1);
}

let failures = 0;

for (const datasetRoot of datasetRoots) {
  const result = await validateDataset(datasetRoot);
  if (!result.ok) {
    failures += 1;
    console.error(`validate failed: ${datasetRoot}`);
    console.error(`manifest: ${result.manifestPath}`);
    console.error(`expected: ${JSON.stringify(result.manifest, null, 2)}`);
    console.error(`actual: ${JSON.stringify(result.rebuiltManifest, null, 2)}`);
    continue;
  }

  console.log(
    [
      `validated ${datasetRoot}`,
      `manifest: ${result.manifestPath}`,
      `totals: files=${result.manifest.totals.sourceFiles} refs=${result.manifest.totals.refs}`,
    ].join("\n"),
  );
}

if (failures > 0) {
  process.exit(1);
}

function parseValidateArgs(argv: string[]):
  | {
      ok: true;
      all: boolean;
      dataset: string;
      outputRoot: string;
    }
  | {
      ok: false;
      error: string;
    } {
  let all = false;
  let dataset = "";
  let outputRoot = DEFAULT_OUTPUT_ROOT;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --dataset" };
      }
      dataset = value;
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

  if (!all && dataset.length === 0) {
    return { ok: false, error: "Either --dataset <path> or --all is required." };
  }

  return {
    ok: true,
    all,
    dataset,
    outputRoot,
  };
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  bun scripts/perf-datasets/validate.ts --dataset <dataset-root>",
      "  bun scripts/perf-datasets/validate.ts --all",
      "",
      `Default generated output root: ${DEFAULT_OUTPUT_ROOT}`,
    ].join("\n"),
  );
}
