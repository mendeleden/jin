import {
  moveDesktopGridPanel,
  resizeDesktopGridPanel,
  type DesktopGridPanelLayout,
} from "./grid-engine";

export type DesktopGridInteractionMode = "move" | "resize";

export interface DesktopGridInteractionSnapshot<TPanelId extends string> {
  mode: DesktopGridInteractionMode;
  panelId: TPanelId;
  startLayout: readonly DesktopGridPanelLayout<TPanelId>[];
  startPanel: DesktopGridPanelLayout<TPanelId>;
}

export function applyDesktopGridInteractionDelta<TPanelId extends string>(
  interaction: DesktopGridInteractionSnapshot<TPanelId>,
  delta: {
    columns: number;
    deltaX: number;
    deltaY: number;
    rows: number;
  },
): DesktopGridPanelLayout<TPanelId>[] {
  if (delta.deltaX === 0 && delta.deltaY === 0) {
    return interaction.startLayout.map((item) => ({ ...item }));
  }

  if (interaction.mode === "move") {
    return moveDesktopGridPanel(
      interaction.startLayout,
      interaction.panelId,
      {
        x: interaction.startPanel.x + delta.deltaX,
        y: interaction.startPanel.y + delta.deltaY,
      },
      { columns: delta.columns, rows: delta.rows },
    );
  }

  return resizeDesktopGridPanel(
    interaction.startLayout,
    interaction.panelId,
    {
      h: interaction.startPanel.h + delta.deltaY,
      w: interaction.startPanel.w + delta.deltaX,
    },
    { columns: delta.columns, handle: "se", rows: delta.rows },
  );
}
