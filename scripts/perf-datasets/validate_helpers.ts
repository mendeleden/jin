import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { DEFAULT_OUTPUT_ROOT } from "./lib";

export { DEFAULT_OUTPUT_ROOT } from "./lib";
export { validateDataset } from "./lib";

export function walkGeneratedDatasetRoots(outputRoot = DEFAULT_OUTPUT_ROOT): string[] {
  if (!existsSync(outputRoot)) {
    return [];
  }

  const datasetRoots: string[] = [];
  for (const scenario of readdirSync(outputRoot).sort()) {
    const scenarioDir = join(outputRoot, scenario);
    for (const scaleTier of readdirSync(scenarioDir).sort()) {
      datasetRoots.push(join(scenarioDir, scaleTier));
    }
  }

  return datasetRoots;
}
