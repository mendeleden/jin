import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const PG_CONN = "postgresql://jin_test:jin_test@localhost:5444/jin_test";
const BRIDGE_NAME = "team-local-postgres";
const REMOTE = "https://github.com/testuser/testapp.git";

const tempHomes: string[] = [];
let pg: SQL;

beforeAll(() => {
  pg = new SQL(PG_CONN);
});

beforeEach(async () => {
  await resetPostgres();
});

afterAll(async () => {
  await resetPostgres();
  await pg.close();

  for (const home of tempHomes) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("persona local Postgres bootstrap", () => {
  test("operator can apply schema, verify compatibility, and mint a bridge code", async () => {
    const before = runCli(
      ["team", "schema", "check", `--connection-string=${PG_CONN}`],
      process.env,
    );
    expect(before.exitCode).toBe(0);
    expect(before.output).toContain("Remote: not initialized");

    const apply = runCli(
      ["team", "schema", "apply", `--connection-string=${PG_CONN}`],
      process.env,
    );
    expect(apply.exitCode).toBe(0);
    expect(apply.output).toContain("Schema applied successfully.");

    const after = runCli(
      ["team", "schema", "check", `--connection-string=${PG_CONN}`],
      process.env,
    );
    expect(after.exitCode).toBe(0);
    expect(after.output).toContain("Remote: v2.4 (compatible)");

    const tables = await pg.unsafe(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('jin_meta', 'jin_conversations', 'jin_messages', 'jin_tool_calls')
        ORDER BY table_name`,
    );
    expect(tables.map((row) => String(row.table_name))).toEqual([
      "jin_conversations",
      "jin_messages",
      "jin_meta",
      "jin_tool_calls",
    ]);

    const constraints = await pg.unsafe(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.jin_tool_calls'::regclass
          AND contype = 'p'`,
    );
    expect(constraints).toEqual([
      expect.objectContaining({
        conname: "jin_tool_calls_pkey",
        definition: "PRIMARY KEY (conversation_id, message_id, id)",
      }),
    ]);

    const bridge = runCli(
      [
        "team",
        "bridge",
        "--type=postgres",
        `--connection-string=${PG_CONN}`,
        `--name=${BRIDGE_NAME}`,
      ],
      process.env,
    );
    expect(bridge.exitCode).toBe(0);
    expect(bridge.output).toContain("jin connect --team=");

    const payload = JSON.parse(Buffer.from(extractBridgeCode(bridge.output), "base64").toString("utf8"));
    expect(payload).toMatchObject({
      type: "postgres",
      id: BRIDGE_NAME,
      connectionString: PG_CONN,
    });
  });

  test("developer connect --team seeds the sink and normalized remote route", async () => {
    const bridgeCode = createBridgeCode();
    const home = makeTempHome();
    const env = cliEnv(home);

    const connect = runCli(
      [
        "connect",
        `--team=${bridgeCode}`,
        `--remote=${REMOTE}`,
      ],
      env,
    );
    expect(connect.exitCode).toBe(0);
    expect(connect.output).toContain(
      "Connected remote:github.com/testuser/testapp -> team-local-postgres (postgres).",
    );

    const config = JSON.parse(
      readFileSync(join(env.JIN_CONFIG_DIR!, "config.json"), "utf8"),
    ) as {
      sinks: Array<Record<string, unknown>>;
      routes: Array<Record<string, unknown>>;
    };

    expect(config.sinks).toContainEqual(
      expect.objectContaining({
        id: BRIDGE_NAME,
        type: "postgres",
        connectionString: PG_CONN,
      }),
    );
    expect(config.routes).toContainEqual({
      match: { remote: "github.com/testuser/testapp" },
      sinks: [BRIDGE_NAME],
    });

    const connections = runCli(["connections"], env);
    expect(connections.exitCode).toBe(0);
    expect(connections.output).toContain("remote=github.com/testuser/testapp");
    expect(connections.output).toContain("team-local-postgres (postgres)");
  });
});

function createBridgeCode(): string {
  const apply = runCli(
    ["team", "schema", "apply", `--connection-string=${PG_CONN}`],
    process.env,
  );
  expect(apply.exitCode).toBe(0);

  const bridge = runCli(
    [
      "team",
      "bridge",
      "--type=postgres",
      `--connection-string=${PG_CONN}`,
      `--name=${BRIDGE_NAME}`,
    ],
    process.env,
  );
  expect(bridge.exitCode).toBe(0);
  return extractBridgeCode(bridge.output);
}

function extractBridgeCode(output: string): string {
  const match = output.match(/jin connect --team=([A-Za-z0-9+/=]+)/);
  expect(match).toBeTruthy();
  return match![1];
}

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "jin-persona-e2e-"));
  tempHomes.push(home);
  return home;
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    JIN_CONFIG_DIR: join(home, ".config", "jin"),
  };
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): { exitCode: number; output: string } {
  const proc = Bun.spawnSync(["bun", "src/index.ts", ...args], {
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output =
    Buffer.from(proc.stdout).toString("utf8") +
    Buffer.from(proc.stderr).toString("utf8");

  return {
    exitCode: proc.exitCode,
    output,
  };
}

async function resetPostgres(): Promise<void> {
  await pg.unsafe(`DROP TABLE IF EXISTS public.jin_tool_calls CASCADE`);
  await pg.unsafe(`DROP TABLE IF EXISTS public.jin_messages CASCADE`);
  await pg.unsafe(`DROP TABLE IF EXISTS public.jin_conversations CASCADE`);
  await pg.unsafe(`DROP TABLE IF EXISTS public.jin_meta CASCADE`);
}
