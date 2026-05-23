import type { RendererState } from "../../renderer";
import {
  LifecycleState,
  RuntimeStateGate,
} from "../../components/shell/status-panels";
import type { DesktopShellActions } from "../../components/shell/actions";
import { DashboardGrid } from "./dashboard-grid";
import {
  HomeAdapterMixPanel,
  HomeProjectActivityPanel,
  HomePulsePanel,
} from "./panels";

export function HomeWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  return (
    <RuntimeStateGate
      actions={actions}
      state={state}
      stopped={{
        description:
          "Desktop remains a client of the daemon boundary and waits for the single runtime owner to come online.",
        label: "Stopped",
        title: "Jin is ready, but the daemon is not running.",
      }}
      transition={{
        startingDescription:
          "Overview data will render once the daemon reaches a steady runtime state.",
        stoppingDescription:
          "Desktop is holding the shell while shutdown completes.",
      }}
    >
      {(snapshot) => {
        if (!snapshot.data) {
          return (
            <LifecycleState
              actions={actions}
              description={
                snapshot.transportError ??
                "Desktop could not load the current overview from the daemon."
              }
              label="Transport"
              state={state}
              title="Home data is temporarily unavailable."
            />
          );
        }

        const { data } = snapshot;
        return (
          <DashboardGrid
            items={[
              { panelId: "usage", children: <HomePulsePanel data={data} /> },
              {
                panelId: "projects",
                children: <HomeProjectActivityPanel data={data} />,
              },
              {
                panelId: "harnesses",
                children: <HomeAdapterMixPanel data={data} />,
              },
            ]}
          />
        );
      }}
    </RuntimeStateGate>
  );
}
