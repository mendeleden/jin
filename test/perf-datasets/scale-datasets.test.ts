import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  generateDataset,
  scenarioScaleCounts,
  validateDataset,
  type ScaleTier,
  type ScenarioName,
} from "../../scripts/perf-datasets/lib";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe("W3-SCALE-01 deterministic scale datasets", () => {
  test("repeated Codex-heavy generation is deterministic", async () => {
    const outputRootA = makeOutputRoot();
    const outputRootB = makeOutputRoot();

    const first = await generateDataset({
      scenario: "codex-heavy",
      scaleTier: "10x",
      outputRoot: outputRootA,
    });
    const second = await generateDataset({
      scenario: "codex-heavy",
      scaleTier: "10x",
      outputRoot: outputRootB,
    });

    expect(first.manifest).toEqual(second.manifest);
  });

  test("all scale tiers generate expected file/ref totals and retain ontology links", async () => {
    const scenarios: ScenarioName[] = ["codex-heavy", "claude-code-heavy", "mixed-rich"];
    const scaleTiers: ScaleTier[] = ["1x", "10x", "100x"];
    const outputRoot = makeOutputRoot();

    for (const scenario of scenarios) {
      for (const scaleTier of scaleTiers) {
        const generated = await generateDataset({ scenario, scaleTier, outputRoot });
        const expected = scenarioScaleCounts(scenario, scaleTier);

        expect(generated.manifest.scaleTier).toBe(scaleTier);
        expect(generated.manifest.scaleUnits).toBe(expected.scaleUnits);
        expect(generated.manifest.totals.sourceFiles).toBe(expected.sourceFiles);
        expect(generated.manifest.totals.refs).toBe(expected.refs);
        expect(generated.manifest.totals.roots).toBe(expected.roots);
        expect(generated.manifest.totals.compacted).toBe(expected.compacted);
        expect(generated.manifest.totals.spawned).toBe(expected.spawned);
        expect(generated.manifest.totals.forked).toBe(0);

        expect(generated.manifest.adapters.every((adapter) => adapter.relationshipsRetained.compacted > 0)).toBe(
          true,
        );
        expect(generated.manifest.adapters.every((adapter) => adapter.relationshipsRetained.spawned > 0)).toBe(
          true,
        );
      }
    }
  });

  test("saved manifest round-trips through the parseability validator", async () => {
    const outputRoot = makeOutputRoot();
    const generated = await generateDataset({
      scenario: "mixed-rich",
      scaleTier: "10x",
      outputRoot,
    });

    const validation = await validateDataset(generated.datasetRoot);
    expect(validation.ok).toBe(true);
    expect(validation.rebuiltManifest).toEqual(validation.manifest);
  });
});

function makeOutputRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-scale-datasets-"));
  tempRoots.push(root);
  return root;
}
