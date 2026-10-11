import type { TurnControlsValue } from "../data/turn-controls-types";
import { listRowPosition } from "./AppListRow.types";
import { iconSize } from "../theme";
import { ControlOption } from "./ControlOption";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Shared model rows for list-based model selection surfaces. Rows of a
 * provider-aware catalog carry their provider's mark; a legacy catalog has none.
 */
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
          leading={
            candidate.provider === null ? undefined : (
              <ProviderIcon provider={candidate.provider} size={iconSize.action} />
            )
          }
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
