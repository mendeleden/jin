import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let runtimeStatus: any;
let runtimePaths: any;
let components: any[];

const fakeQueryStore = {
  database: {},
  getMessages: () => [],
};

mock.module("../src/daemon/process-state", () => ({
  getAllState: () => components,
  getWatcherState: () => components.find((component) => component.name === "watcher") ?? { status: "stopped" },
  stopWatcher: async () => ({ requested: false, completed: true, forced: false }),
}));

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimePaths: () => runtimePaths,
  getRuntimeStatus: () => runtimeStatus,
  isServiceInstalled: () => false,
  markRuntimeStarting: () => runtimeStatus,
  markRuntimeRunning: () => runtimeStatus,
  clearRuntimeState: () => {},
  runModeLabel: (mode: string) => mode,
}));

const {
  buildLifecycleCommand,
  createLocalControlBoundary,
  getLocalControlStatus,
} = await import("../src/api/control");
const { createRoutes, matchRoute } = await import("../src/api/routes");
const { startLocalApiServer } = await import("../src/api/server");
const { DESKTOP_AUTH_HEADER } = await import("../src/api/auth");
const { requestDaemonConfigReload } = await import("../src/api/client");

function makeOwner(mode: "daemon" | "service" | "foreground", pid = 515) {
  return {
    pid,
    mode,
    startedAt: "2026-04-02T12:00:00.000Z",
    configDir: runtimePaths.configDir,
    storePath: runtimePaths.storePath,
    logPath: runtimePaths.logPath,
    localEndpoint: runtimePaths.localEndpoint,
  };
}

beforeEach(() => {
  runtimePaths = {
    configDir: "/tmp/jin",
    configPath: "/tmp/jin/config.json",
    storePath: "/tmp/jin/store.db",
    logPath: "/tmp/jin/jin.log",
    localEndpoint: "/tmp/jin/jin.sock",
    socketPath: "/tmp/jin/jin.sock",
  };
  runtimeStatus = { state: "stopped", issues: [] };
  components = [
    { name: "watcher", status: "stopped", lifecycleState: "stopped" },
  ];
});

afterAll(() => {
  mock.restore();
});

describe("local control boundary", () => {
  test("reports stopped runtime status without starting a hidden runtime", () => {
    const status = getLocalControlStatus();

    expect(status.runtime.state).toBe("stopped");
    expect(status.health.status).toBe("stopped");
    expect(status.health.ingest).toBe("inactive");
    expect(status.health.push).toBe("inactive");
    expect(status.paths.store).toBe(runtimePaths.storePath);
    expect(status.paths.localEndpoint).toBe(runtimePaths.localEndpoint);
    expect(status.paths.socket).toBe(runtimePaths.socketPath);
    expect(status.components[0].status).toBe("stopped");
  });

  test("reports running runtime health for local clients", () => {
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon"),
      issues: [],
    };
    components = [
      {
        name: "watcher",
        status: "running",
        pid: 515,
        mode: "daemon",
        uptime: "5m",
        lifecycleState: "running",
      },
    ];

    const status = getLocalControlStatus();

    expect(status.runtime.state).toBe("running");
    expect(status.runtime.owner?.mode).toBe("daemon");
    expect(status.health.status).toBe("healthy");
    expect(status.health.issueCount).toBe(0);
    expect(status.health.components.running).toBe(1);
  });

  test("reports degraded runtime health with subsystem detail", () => {
    runtimeStatus = {
      state: "degraded",
      owner: makeOwner("daemon"),
      issues: [
        {
          subsystem: "push",
          message: "sink paused by operator: postgres-team",
          paused: true,
        },
      ],
    };
    components = [
      {
        name: "watcher",
        status: "running",
        pid: 515,
        mode: "daemon",
        lifecycleState: "degraded",
        issues: runtimeStatus.issues,
      },
    ];

    const status = getLocalControlStatus();

    expect(status.runtime.state).toBe("degraded");
    expect(status.health.status).toBe("degraded");
    expect(status.health.issueCount).toBe(1);
    expect(status.health.issueSubsystems).toEqual(["push"]);
    expect(status.health.push).toBe("paused");
    expect(status.health.ingest).toBe("healthy");
  });

  test("control routes delegate lifecycle actions instead of becoming a runtime", async () => {
    const actionCalls: string[] = [];
    const routes = createRoutes({
      queryStore: fakeQueryStore as any,
      controlBoundary: createLocalControlBoundary({
        getStatus: () => ({
          runtime: {
            state: "running",
            owner: makeOwner("service", 777),
            issues: [],
          },
          health: {
            status: "healthy",
            issueCount: 0,
            issueSubsystems: [],
            paused: false,
            ingest: "healthy",
            push: "healthy",
            components: { running: 1, stopped: 0 },
          },
          components: [
            {
              name: "watcher",
              status: "running",
              pid: 777,
              mode: "service",
              lifecycleState: "running",
            },
          ],
          paths: {
            configDir: runtimePaths.configDir,
            config: runtimePaths.configPath,
            store: runtimePaths.storePath,
            log: runtimePaths.logPath,
            localEndpoint: runtimePaths.localEndpoint,
            socket: runtimePaths.socketPath,
          },
        }),
        executeAction: async (action) => {
          actionCalls.push(action);
          return {
            exitCode: action === "start" ? 1 : 0,
            stdout: "",
            stderr:
              action === "start"
                ? "jin is already running under the OS service manager"
                : "",
          };
        },
      }),
    });

    const startRoute = matchRoute(routes, "POST", "/api/control/start");
    expect(startRoute).not.toBeNull();
    const startResponse = await startRoute!.handler(
      new Request("http://localhost/api/control/start", { method: "POST" }),
      startRoute!.params,
    );
    const startPayload = await startResponse.json();

    expect(startResponse.status).toBe(409);
    expect(startPayload.action).toBe("start");
    expect(startPayload.status.runtime.owner.mode).toBe("service");
    expect(startPayload.status.paths.socket).toBe(runtimePaths.socketPath);

    const restartRoute = matchRoute(routes, "POST", "/api/control/restart");
    expect(restartRoute).not.toBeNull();
    const restartResponse = await restartRoute!.handler(
      new Request("http://localhost/api/control/restart", { method: "POST" }),
      restartRoute!.params,
    );

    expect(restartResponse.status).toBe(200);
    expect(actionCalls).toEqual(["start", "restart"]);
  });

  test("config reload route delegates to the attached pipeline reload callback", async () => {
    const reloadCalls: string[] = [];
    const routes = createRoutes({
      queryStore: fakeQueryStore as any,
      controlBoundary: createLocalControlBoundary({
        requestConfigReload: (source) => {
          reloadCalls.push(source);
          return true;
        },
      }),
    });

    const route = matchRoute(routes, "POST", "/api/control/config/reload");
    expect(route).not.toBeNull();

    const response = await route!.handler(
      new Request("http://localhost/api/control/config/reload", {
        method: "POST",
      }),
      route!.params,
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.accepted).toBe(true);
    expect(payload.message).toBe("Config reload accepted.");
    expect(reloadCalls).toEqual(["command"]);
  });

  test("config reload route rejects unauthenticated local API requests", async () => {
    const reloadCalls: string[] = [];
    const serveCalls: Array<{
      fetch: (request: Request) => Promise<Response>;
    }> = [];
    const server = startLocalApiServer({
      authToken: "reload-test-token",
      platform: "darwin",
      queryStore: fakeQueryStore as any,
      socketPath: "/tmp/jin-local-control-boundary.sock",
      controlBoundary: createLocalControlBoundary({
        requestConfigReload: (source) => {
          reloadCalls.push(source);
          return true;
        },
      }),
      serve: (options) => {
        serveCalls.push({ fetch: options.fetch });
        return { stop() {} };
      },
    });

    const unauthorizedResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/control/config/reload", {
        method: "POST",
      }),
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(reloadCalls).toEqual([]);

    const authorizedResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/control/config/reload", {
        method: "POST",
        headers: { [DESKTOP_AUTH_HEADER]: "reload-test-token" },
      }),
    );
    const authorizedPayload = await authorizedResponse.json();

    expect(authorizedResponse.status).toBe(202);
    expect(authorizedPayload.accepted).toBe(true);
    expect(reloadCalls).toEqual(["command"]);

    server?.stop();
  });

  test("config reload client posts to the authenticated local Unix socket endpoint", async () => {
    const requests: Array<{ input: unknown; init: RequestInit & { unix?: string } }> = [];

    const result = await requestDaemonConfigReload({
      endpoint: "/tmp/jin-reload.sock",
      token: "client-test-token",
      timeoutMs: 500,
      fetch: async (input, init) => {
        requests.push({
          input,
          init: init as RequestInit & { unix?: string },
        });
        return new Response(
          JSON.stringify({
            accepted: true,
            message: "Config reload accepted.",
          }),
          { status: 202 },
        );
      },
    });

    expect(result).toEqual({
      status: "accepted",
      statusCode: 202,
      message: "Config reload accepted.",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].input).toBe(
      "http://localhost/api/control/config/reload",
    );
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.unix).toBe("/tmp/jin-reload.sock");
    expect(
      new Headers(requests[0].init.headers).get(DESKTOP_AUTH_HEADER),
    ).toBe("client-test-token");
  });

  test("packaged Desktop lifecycle actions resolve the installed jin CLI from PATH", () => {
    const command = buildLifecycleCommand("restart", {
      electron: true,
      env: {
        PATH: "/Applications/Jin.app/Contents/MacOS:/opt/homebrew/bin:/usr/bin",
      },
      exists: (path) => path === "/opt/homebrew/bin/jin",
      platform: "darwin",
    });

    expect(command).toEqual(["/opt/homebrew/bin/jin", "restart"]);
    expect(command).not.toContain("bun");
    expect(command).not.toContain("src/index.ts");
  });

  test("packaged Desktop lifecycle actions fall back to known install paths outside shell PATH", () => {
    const command = buildLifecycleCommand("start", {
      electron: true,
      env: {
        HOME: "/Users/tester",
        PATH: "/usr/bin:/bin",
      },
      exists: (path) => path === "/Users/tester/.local/bin/jin",
      platform: "darwin",
    });

    expect(command).toEqual(["/Users/tester/.local/bin/jin", "start"]);
  });

  test("packaged Desktop lifecycle actions allow an explicit CLI path override", () => {
    const command = buildLifecycleCommand("stop", {
      electron: true,
      env: {
        JIN_DESKTOP_CLI_PATH: "/custom/bin/jin",
        PATH: "",
      },
      exists: () => false,
      platform: "linux",
    });

    expect(command).toEqual(["/custom/bin/jin", "stop"]);
  });

  test("packaged Desktop lifecycle actions use Windows PATH semantics on Windows", () => {
    const command = buildLifecycleCommand("restart", {
      electron: true,
      env: {
        PATH: "C:\\Tools;C:\\Jin\\bin",
      },
      exists: (path) => path === "C:\\Jin\\bin\\jin.exe",
      platform: "win32",
    });

    expect(command).toEqual(["C:\\Jin\\bin\\jin.exe", "restart"]);
  });

  test("packaged Desktop lifecycle actions use Windows install paths on Windows", () => {
    const command = buildLifecycleCommand("start", {
      electron: true,
      env: {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: "C:\\Users\\tester",
      },
      exists: (path) => path === "C:\\Users\\tester\\.local\\bin\\jin.exe",
      platform: "win32",
    });

    expect(command).toEqual(["C:\\Users\\tester\\.local\\bin\\jin.exe", "start"]);
  });

  test("repo-local lifecycle command remains available outside Electron", () => {
    const command = buildLifecycleCommand("stop", {
      argv: ["bun", "/repo/src/index.ts", "stop"],
      electron: false,
      execPath: "/usr/local/bin/bun",
      platform: "darwin",
    });

    expect(command).toEqual(["/usr/local/bin/bun", "run", "/repo/src/index.ts", "stop"]);
  });
});
