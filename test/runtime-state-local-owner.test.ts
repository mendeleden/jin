import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const DEFAULT_PROCESS_LSTART = "Wed Apr 29 12:00:00 2026";
const DEFAULT_PROCESS_STARTED_AT = new Date(DEFAULT_PROCESS_LSTART).toISOString();

const PROBE_SCRIPT = `
import { mock } from "bun:test";

const encoder = new TextEncoder();
const opts = JSON.parse(process.env.JIN_TEST_RUNTIME_STATE_OPTS || "{}");
const livePids = new Set((opts.livePids || []).map((pid) => Number(pid)));

const response = (stdout = "", exitCode = 0, stderr = "") => ({
  stdout: encoder.encode(stdout),
  stderr: encoder.encode(stderr),
  status: exitCode,
  exitCode,
  success: exitCode === 0,
});

function fakeSpawnSync(command, args = []) {
  const binary = String(command);
  const argv = Array.isArray(args) ? args.map((part) => String(part)) : [];
  const joined = argv.join(" ");

  if (process.platform === "linux") {
    if (binary === "systemctl" && joined === "--user is-active jin.service") {
      return response(opts.serviceActive ? "active\\n" : "inactive\\n", opts.serviceActive ? 0 : 3);
    }
    if (binary === "systemctl" && joined === "--user show jin.service --property MainPID --value") {
      return response(String(opts.servicePid ?? 0) + "\\n");
    }
    if (binary === "ps" && argv[0] === "-o" && argv[1] === "tty=") {
      return response("?\\n");
    }
    if (binary === "ps" && argv[0] === "-o" && argv[1] === "lstart=") {
      return response((opts.processStartedAt || "Wed Apr 29 12:00:00 2026") + "\\n");
    }
  }

  if (process.platform === "darwin") {
    if (binary === "id" && joined === "-u") {
      return response("501\\n");
    }
    if (binary === "launchctl" && argv[0] === "print") {
      if (!opts.serviceActive) {
        return response("", 1, "not found");
      }
      const pidLine = opts.servicePid ? "    pid = " + opts.servicePid + "\\n" : "";
      return response("state = running\\n" + pidLine + "last exit code = 0\\n");
    }
    if (binary === "ps" && argv[0] === "-o" && argv[1] === "tty=") {
      return response("??\\n");
    }
    if (binary === "ps" && argv[0] === "-o" && argv[1] === "lstart=") {
      return response((opts.processStartedAt || "Wed Apr 29 12:00:00 2026") + "\\n");
    }
  }

  if (process.platform === "win32") {
    if (binary.toLowerCase() === "powershell") {
      const command = joined;
      if (command.includes("Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue).State")) {
        return response(opts.serviceActive ? "Running\\r\\n" : "\\r\\n");
      }
      if (command.includes("Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue")) {
        return response(opts.serviceInstalled ? "\\\\Jin\\\\jin-agent-S-1-5-21-test\\r\\n" : "\\r\\n");
      }
      return response("\\r\\n");
    }
  }

  return response("", 1, "unexpected spawnSync command: " + [binary, ...argv].join(" "));
}

mock.module("./src/daemon/child-process.ts", () => ({
  spawnSync: fakeSpawnSync,
}));

process.kill = ((pid, signal = 0) => {
  if (signal === 0 && (livePids.has(Number(pid)) || Number(pid) === process.pid)) {
    return true;
  }
  throw new Error("ESRCH");
});

const runtimeState = await import("./src/daemon/runtime-state.ts");
if (opts.action === "clearPidFile") {
  runtimeState.clearRuntimePidFile(opts.ownerPid);
  const { existsSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const pidPath = join(process.env.JIN_CONFIG_DIR, "jin.pid");
  console.log(JSON.stringify({
    exists: existsSync(pidPath),
    contents: existsSync(pidPath) ? readFileSync(pidPath, "utf-8").trim() : null,
  }));
} else if (opts.action === "selfStatus") {
  const status = runtimeState.getRuntimeStatusForCurrentProcess("daemon");
  const { existsSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const pidPath = join(process.env.JIN_CONFIG_DIR, "jin.pid");
  const runtimePath = join(process.env.JIN_CONFIG_DIR, "jin.runtime.json");
  console.log(JSON.stringify({
    status,
    pidFile: existsSync(pidPath) ? readFileSync(pidPath, "utf-8").trim() : null,
    runtimeFileExists: existsSync(runtimePath),
  }));
} else if (opts.action === "selfApiStatus") {
  const { createLocalControlBoundary } = await import("./src/api/control.ts");
  const { startLocalApiServer } = await import("./src/api/server.ts");
  const paths = runtimeState.getRuntimePaths();
  let fetchHandler;
  const server = startLocalApiServer({
    authToken: "self-api-test-token",
    controlBoundary: createLocalControlBoundary({ currentRuntimeMode: "daemon" }),
    queryStore: { database: {} },
    socketPath: paths.socketPath,
    serve: (options) => {
      fetchHandler = options.fetch;
      return { stop() {} };
    },
  });
  const routedResponse = await fetchHandler(new Request("http://localhost/api/control/status", {
    headers: { "x-jin-desktop-token": "self-api-test-token" },
  }));
  const status = await routedResponse.json();
  server?.stop();
  console.log(JSON.stringify({
    statusCode: routedResponse.status,
    runtime: status.runtime,
    components: status.components,
  }));
} else if (opts.action === "selfApiStop") {
  const { createLocalControlBoundary } = await import("./src/api/control.ts");
  const { startLocalApiServer } = await import("./src/api/server.ts");
  const paths = runtimeState.getRuntimePaths();
  let fetchHandler;
  const server = startLocalApiServer({
    authToken: "self-api-test-token",
    controlBoundary: createLocalControlBoundary({
      currentRuntimeMode: "daemon",
      executeAction: async () => {
        const seen = runtimeState.getRuntimeStatus();
        return {
          exitCode: seen.state === "running" && seen.owner?.pid === process.pid ? 0 : 1,
          stdout: JSON.stringify(seen),
          stderr: "",
        };
      },
    }),
    queryStore: { database: {} },
    socketPath: paths.socketPath,
    serve: (options) => {
      fetchHandler = options.fetch;
      return { stop() {} };
    },
  });
  const response = await fetchHandler(new Request("http://localhost/api/control/stop", {
    method: "POST",
    headers: { "x-jin-desktop-token": "self-api-test-token" },
  }));
  const payload = await response.json();
  server?.stop();
  console.log(JSON.stringify({
    statusCode: response.status,
    ok: payload.ok,
    seen: JSON.parse(payload.stdout),
    runtime: payload.status.runtime,
  }));
} else {
  console.log(JSON.stringify(runtimeState.getRuntimeStatus()));
}
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

  test("does not let stale stopping state poison a newer daemon owner", () => {
    const configDir = createRuntimeEnv();
    writeFileSync(join(configDir, "jin.pid"), "5152\n");
    writeRuntimeState(configDir, {
      state: "stopping",
      owner: makeOwner(configDir, "daemon", 5151),
      issues: [],
      updatedAt: "2026-04-29T19:00:00.000Z",
    });

    const result = runProbe(configDir, {
      livePids: [5152],
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.state).toBe("running");
    expect(status.owner.mode).toBe("daemon");
    expect(status.owner.pid).toBe(5152);
  });

  (process.platform === "linux" || process.platform === "darwin" ? test : test.skip)(
    "does not let stale stopping state poison a reused pid owner",
    () => {
      const configDir = createRuntimeEnv();
      writeFileSync(join(configDir, "jin.pid"), "5151\n");
      writeRuntimeState(configDir, {
        state: "stopping",
        owner: makeOwner(configDir, "daemon", 5151),
        issues: [],
        updatedAt: "2026-04-29T19:00:00.000Z",
      });

      const result = runProbe(configDir, {
        livePids: [5151],
        processStartedAt: "Thu Apr 30 12:00:00 2026",
      });

      expect(result.exitCode).toBe(0);
      const status = JSON.parse(result.stdout);
      expect(status.state).toBe("running");
      expect(status.owner.mode).toBe("daemon");
      expect(status.owner.pid).toBe(5151);
      expect(status.owner.startedAt).not.toBe(DEFAULT_PROCESS_STARTED_AT);
    },
  );

  test("stale cleanup does not remove a newer daemon pid file", () => {
    const configDir = createRuntimeEnv();
    writeFileSync(join(configDir, "jin.pid"), "5152\n");

    const result = runProbe(configDir, {
      action: "clearPidFile",
      ownerPid: 5151,
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status).toEqual({ exists: true, contents: "5152" });
  });

  test("current process status repairs missing owner files for a live runtime", () => {
    const configDir = createRuntimeEnv();

    const result = runProbe(configDir, {
      action: "selfStatus",
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.status.state).toBe("running");
    expect(payload.status.owner.mode).toBe("daemon");
    expect(payload.pidFile).toBe(String(payload.status.owner.pid));
    expect(payload.runtimeFileExists).toBe(true);
  });

  test("live local control API reports current process when owner files are missing", () => {
    const configDir = createRuntimeEnv();

    const result = runProbe(configDir, {
      action: "selfApiStatus",
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.statusCode).toBe(200);
    expect(payload.runtime.state).toBe("running");
    expect(payload.runtime.owner.mode).toBe("daemon");
    expect(payload.components[0].status).toBe("running");
    expect(payload.components[0].pid).toBe(payload.runtime.owner.pid);
  });

  test("live local control API repairs owner files before delegating stop", () => {
    const configDir = createRuntimeEnv();

    const result = runProbe(configDir, {
      action: "selfApiStop",
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.seen.state).toBe("running");
    expect(payload.seen.owner.mode).toBe("daemon");
    expect(payload.runtime.state).toBe("running");
    expect(payload.runtime.owner.pid).toBe(payload.seen.owner.pid);
  });
});

function createRuntimeEnv(): string {
  const root = join(process.cwd(), ".tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "jin-runtime-state-"));
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
    startedAt: DEFAULT_PROCESS_STARTED_AT,
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
