import { readdir } from "fs/promises";
import { join, relative } from "path";

const INTEGRATION_TESTS = new Set([
  "test/persona-local-postgres.test.ts",
]);
const POSTGRES_COMPOSE_FILE = "test/docker-compose.integration.yml";

type Mode = "unit" | "integration" | "all";

const mode = parseMode(process.argv[2]);

try {
  if (mode === "unit" || mode === "all") {
    const unitTests = (await findTestFiles("test")).filter(
      (file) => !INTEGRATION_TESTS.has(file),
    );
    await runTestFiles(unitTests);
  }

  if (mode === "integration" || mode === "all") {
    await runIntegrationTests();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseMode(value: string | undefined): Mode {
  if (!value) {
    return "unit";
  }

  if (value === "unit" || value === "integration" || value === "all") {
    return value;
  }

  throw new Error(`Unknown test mode "${value}". Use unit, integration, or all.`);
}

async function findTestFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative(process.cwd(), path));
    }
  }

  return files.sort();
}

async function runTestFiles(files: string[]): Promise<void> {
  for (const file of files) {
    await run(["bun", "test", file]);
  }
}

async function runIntegrationTests(): Promise<void> {
  await run([
    "docker",
    "compose",
    "-f",
    POSTGRES_COMPOSE_FILE,
    "up",
    "-d",
    "--wait",
    "postgres",
  ]);

  let status = 0;
  try {
    for (const file of INTEGRATION_TESTS) {
      await run(["bun", "test", file]);
    }
  } catch (error) {
    status = 1;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    await run([
      "docker",
      "compose",
      "-f",
      POSTGRES_COMPOSE_FILE,
      "down",
      "-v",
    ]);
  }

  if (status !== 0) {
    throw new Error("Integration tests failed.");
  }
}

async function run(cmd: string[]): Promise<void> {
  console.log(`\n$ ${cmd.join(" ")}`);
  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${exitCode}`);
  }
}
