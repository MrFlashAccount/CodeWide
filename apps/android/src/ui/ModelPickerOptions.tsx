import type { TurnControlsValue } from "../data/turn-controls-types";
import { listRowPosition } from "./AppListRow.types";
import { ControlOption } from "./ControlOption";

/** Shared model rows for list-based model selection surfaces. */
export function ModelPickerOptions({
  models,
  onSelect,
  selectedModel,
}: {
  readonly models: readonly TurnControlsValue["models"][number][];
  readonly onSelect: (model: TurnControlsValue["models"][number]) => void;
  readonly selectedModel: string | null;
}): React.JSX.Element {
  return (
    <>
      {models.map((candidate, index) => (
        <ControlOption
          key={candidate.id}
          onPress={() => {
            onSelect(candidate);
          }}
          position={listRowPosition(index, models.length)}
          selected={candidate.id === selectedModel}
          subtitle={candidate.id}
          title={candidate.label}
        />
      ))}
    </>
  );
}
