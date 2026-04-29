import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROBE_SCRIPT = `
const encoder = new TextEncoder();
const opts = JSON.parse(process.env.JIN_TEST_RUNTIME_STATE_OPTS || "{}");
const livePids = new Set((opts.livePids || []).map((pid) => Number(pid)));

const response = (stdout = "", exitCode = 0, stderr = "") => ({
  stdout: encoder.encode(stdout),
  stderr: encoder.encode(stderr),
  exitCode,
  success: exitCode === 0,
});

Bun.spawnSync = ((cmd) => {
  const binary = Array.isArray(cmd) ? String(cmd[0]) : "";
  const args = Array.isArray(cmd) ? cmd.slice(1).map((part) => String(part)) : [];
  const joined = args.join(" ");

  if (process.platform === "linux") {
    if (binary === "systemctl" && joined === "--user is-active jin.service") {
      return response(opts.serviceActive ? "active\\n" : "inactive\\n", opts.serviceActive ? 0 : 3);
    }
    if (binary === "systemctl" && joined === "--user show jin.service --property MainPID --value") {
      return response(String(opts.servicePid ?? 0) + "\\n");
    }
    if (binary === "ps" && args[0] === "-o" && args[1] === "tty=") {
      return response("?\\n");
    }
    if (binary === "ps" && args[0] === "-o" && args[1] === "lstart=") {
      return response("Mon Apr 29 12:00:00 2026\\n");
    }
  }

  if (process.platform === "darwin") {
    if (binary === "id" && joined === "-u") {
      return response("501\\n");
    }
    if (binary === "launchctl" && args[0] === "print") {
      if (!opts.serviceActive) {
        return response("", 1, "not found");
      }
      const pidLine = opts.servicePid ? "    pid = " + opts.servicePid + "\\n" : "";
      return response("state = running\\n" + pidLine + "last exit code = 0\\n");
    }
    if (binary === "ps" && args[0] === "-o" && args[1] === "tty=") {
      return response("??\\n");
    }
    if (binary === "ps" && args[0] === "-o" && args[1] === "lstart=") {
      return response("Mon Apr 29 12:00:00 2026\\n");
    }
  }

  if (process.platform === "win32") {
    if (binary.toLowerCase() === "powershell") {
      const command = joined;
      if (command.includes("Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue).State")) {
        return response(opts.serviceActive ? "Running\\r\\n" : "\\r\\n");
      }
      if (command.includes("Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue")) {
        return response(opts.serviceInstalled ? "jin\\r\\n" : "\\r\\n");
      }
      return response("\\r\\n");
    }
  }

  return response("", 1, "unexpected spawnSync command: " + [binary, ...args].join(" "));
});

process.kill = ((pid, signal = 0) => {
  if (signal === 0 && livePids.has(Number(pid))) {
    return true;
  }
  throw new Error("ESRCH");
});

const runtimeState = await import("./src/daemon/runtime-state.ts");
console.log(JSON.stringify(runtimeState.getRuntimeStatus()));
`;

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    rmSync(cleanups.pop()!, { recursive: true, force: true });
  }
});

describe("runtime-state local ownership scoping", () => {
  test("ignores unrelated global service activity when no local owner evidence exists", () => {
    const configDir = createRuntimeEnv();
    const result = runProbe(configDir, {
      serviceActive: true,
      servicePid: 4242,
      livePids: [4242],
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status).toEqual({
      state: "stopped",
      issues: [],
    });
  });

  test("keeps a local daemon owner even when a different service is active", () => {
    const configDir = createRuntimeEnv();
    writeFileSync(join(configDir, "jin.pid"), "5151\n");
    writeRuntimeState(configDir, {
      state: "running",
      owner: makeOwner(configDir, "daemon", 5151),
      issues: [],
      updatedAt: "2026-04-29T19:00:00.000Z",
    });

    const result = runProbe(configDir, {
      serviceActive: true,
      servicePid: 4242,
      livePids: [4242, 5151],
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.state).toBe("running");
    expect(status.owner.mode).toBe("daemon");
    expect(status.owner.pid).toBe(5151);
  });

  test("reports a service owner only when the current runtime state belongs to that service", () => {
    const configDir = createRuntimeEnv();
    writeRuntimeState(configDir, {
      state: "running",
      owner: makeOwner(configDir, "service", 4242),
      issues: [],
      updatedAt: "2026-04-29T19:00:00.000Z",
    });

    const result = runProbe(configDir, {
      serviceActive: true,
      servicePid: 4242,
      livePids: [4242],
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.state).toBe("running");
    expect(status.owner.mode).toBe("service");
    expect(status.owner.pid).toBe(4242);
  });
});

function createRuntimeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), "jin-runtime-state-"));
  mkdirSync(dir, { recursive: true });
  cleanups.push(dir);
  return dir;
}

function writeRuntimeState(configDir: string, payload: Record<string, unknown>): void {
  writeFileSync(
    join(configDir, "jin.runtime.json"),
    JSON.stringify(payload, null, 2),
  );
}

function makeOwner(configDir: string, mode: "daemon" | "service", pid: number) {
  return {
    pid,
    mode,
    startedAt: "2026-04-29T19:00:00.000Z",
    configDir,
    storePath: join(configDir, "store.db"),
    logPath: join(configDir, "jin.log"),
  };
}

function runProbe(configDir: string, options: Record<string, unknown>) {
  const proc = Bun.spawnSync(
    ["bun", "-e", PROBE_SCRIPT],
    {
      env: {
        ...process.env,
        JIN_CONFIG_DIR: configDir,
        JIN_TEST_RUNTIME_STATE_OPTS: JSON.stringify(options),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  if (existsSync(join(configDir, "jin.runtime.json")) && proc.exitCode !== 0) {
    unlinkSync(join(configDir, "jin.runtime.json"));
  }

  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}
