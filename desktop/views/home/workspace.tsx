import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useDesktopLayoutPreferences } from "../../layout/preferences";
import type { RendererState } from "../../renderer";
import {
  LifecycleState,
  RuntimeStateGate,
} from "../../components/shell/status-panels";
import type { DesktopShellActions } from "../../components/shell/actions";
import { Button } from "../../ui/button";
import { DashboardGrid } from "./dashboard-grid";
import {
  DEFAULT_HOME_PANEL_LAYOUT,
  normalizeHomePanelLayout,
  type HomePanelLayout,
} from "./layout";
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
          <HomeLayoutEditor>
            {({
              editing,
              layout,
              onCancel,
              onEdit,
              onLayoutChange,
              onReset,
              onSave,
            }) => (
              <div
                className="flex min-h-0 flex-1 flex-col gap-3"
                data-home-layout-workspace
              >
                <HomeLayoutToolbar
                  editing={editing}
                  onCancel={onCancel}
                  onEdit={onEdit}
                  onReset={onReset}
                  onSave={onSave}
                />
                <DashboardGrid
                  editable={editing}
                  items={[
                    {
                      panelId: "usage",
                      children: ({ panel }) => (
                        <HomePulsePanel data={data} panel={panel} />
                      ),
                    },
                    {
                      panelId: "projects",
                      children: ({ panel }) => (
                        <HomeProjectActivityPanel data={data} panel={panel} />
                      ),
                    },
                    {
                      panelId: "harnesses",
                      children: ({ panel }) => (
                        <HomeAdapterMixPanel data={data} panel={panel} />
                      ),
                    },
                  ]}
                  layout={layout}
                  onLayoutChange={onLayoutChange}
                />
              </div>
            )}
          </HomeLayoutEditor>
        );
      }}
    </RuntimeStateGate>
  );
}

function HomeLayoutEditor({
  children,
}: {
  children(props: {
    editing: boolean;
    layout: readonly HomePanelLayout[];
    onCancel(): void;
    onEdit(): void;
    onLayoutChange(layout: readonly HomePanelLayout[]): void;
    onReset(): void;
    onSave(): void;
  }): ReactNode;
}) {
  const { homeLayout, setHomeLayout } = useDesktopLayoutPreferences();
  const [editing, setEditing] = useState(false);
  const [draftLayout, setDraftLayout] = useState<readonly HomePanelLayout[]>(
    () => normalizeHomePanelLayout(homeLayout),
  );

  useEffect(() => {
    if (!editing) {
      setDraftLayout(normalizeHomePanelLayout(homeLayout));
    }
  }, [editing, homeLayout]);

  return children({
    editing,
    layout: editing ? draftLayout : homeLayout,
    onCancel() {
      setDraftLayout(normalizeHomePanelLayout(homeLayout));
      setEditing(false);
    },
    onEdit() {
      setDraftLayout(normalizeHomePanelLayout(homeLayout));
      setEditing(true);
    },
    onLayoutChange(nextLayout) {
      setDraftLayout(normalizeHomePanelLayout(nextLayout));
    },
    onReset() {
      setDraftLayout(normalizeHomePanelLayout(DEFAULT_HOME_PANEL_LAYOUT));
    },
    onSave() {
      setHomeLayout(draftLayout);
      setEditing(false);
    },
  });
}

function HomeLayoutToolbar({
  editing,
  onCancel,
  onEdit,
  onReset,
  onSave,
}: {
  editing: boolean;
  onCancel(): void;
  onEdit(): void;
  onReset(): void;
  onSave(): void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      data-home-layout-toolbar
    >
      {editing ? (
        <>
          <Button onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            Reset
          </Button>
          <Button onClick={onCancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
          <Button onClick={onSave} variant="primary">
            <Check aria-hidden="true" />
            Save
          </Button>
        </>
      ) : (
        <Button onClick={onEdit}>
          <Pencil aria-hidden="true" />
          Edit layout
        </Button>
      )}
    </div>
  );
}
