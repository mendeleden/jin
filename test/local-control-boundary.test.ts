import { beforeEach, describe, expect, mock, test } from "bun:test";

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
  getDashboardState: () => components.find((component) => component.name === "dashboard") ?? { status: "stopped" },
  stopWatcher: async () => ({ requested: false, completed: true, forced: false }),
  stopDashboard: async () => {},
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
  createLocalControlBoundary,
  getLocalControlStatus,
} = await import("../src/api/control");
const { createRoutes, matchRoute } = await import("../src/api/routes");

function makeOwner(mode: "daemon" | "service" | "foreground", pid = 515) {
  return {
    pid,
    mode,
    startedAt: "2026-04-02T12:00:00.000Z",
    configDir: runtimePaths.configDir,
    storePath: runtimePaths.storePath,
    logPath: runtimePaths.logPath,
  };
}

beforeEach(() => {
  runtimePaths = {
    configDir: "/tmp/jin",
    configPath: "/tmp/jin/config.json",
    storePath: "/tmp/jin/store.db",
    logPath: "/tmp/jin/jin.log",
  };
  runtimeStatus = { state: "stopped", issues: [] };
  components = [
    { name: "watcher", status: "stopped", lifecycleState: "stopped" },
    { name: "dashboard", status: "stopped" },
  ];
});

describe("local control boundary", () => {
  test("reports stopped runtime status without starting a hidden runtime", () => {
    const status = getLocalControlStatus();

    expect(status.runtime.state).toBe("stopped");
    expect(status.health.status).toBe("stopped");
    expect(status.health.ingest).toBe("inactive");
    expect(status.health.push).toBe("inactive");
    expect(status.paths.store).toBe(runtimePaths.storePath);
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
      {
        name: "dashboard",
        status: "running",
        pid: 616,
        port: 4000,
      },
    ];

    const status = getLocalControlStatus();

    expect(status.runtime.state).toBe("running");
    expect(status.runtime.owner?.mode).toBe("daemon");
    expect(status.health.status).toBe("healthy");
    expect(status.health.issueCount).toBe(0);
    expect(status.health.components.running).toBe(2);
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
      { name: "dashboard", status: "stopped" },
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
            components: { running: 1, stopped: 1 },
          },
          components: [
            {
              name: "watcher",
              status: "running",
              pid: 777,
              mode: "service",
              lifecycleState: "running",
            },
            { name: "dashboard", status: "stopped" },
          ],
          paths: {
            configDir: runtimePaths.configDir,
            config: runtimePaths.configPath,
            store: runtimePaths.storePath,
            log: runtimePaths.logPath,
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

    const restartRoute = matchRoute(routes, "POST", "/api/control/restart");
    expect(restartRoute).not.toBeNull();
    const restartResponse = await restartRoute!.handler(
      new Request("http://localhost/api/control/restart", { method: "POST" }),
      restartRoute!.params,
    );

    expect(restartResponse.status).toBe(200);
    expect(actionCalls).toEqual(["start", "restart"]);
  });
});
