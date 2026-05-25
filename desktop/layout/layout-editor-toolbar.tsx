import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { Button } from "../ui/button";

export function LayoutEditorToolbar({
  editing,
  onCancel,
  onEdit,
  onReset,
  onSave,
  surface,
}: {
  editing: boolean;
  onCancel(): void;
  onEdit(): void;
  onReset(): void;
  onSave(): void;
  surface: string;
}) {
  const surfaceToolbarAttribute = `data-${surface}-layout-toolbar`;

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      data-layout-toolbar={surface}
      {...{ [surfaceToolbarAttribute]: true }}
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
          <Button onClick={onSave}>
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
