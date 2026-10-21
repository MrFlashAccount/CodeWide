import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { colors, iconSize } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { mergeCardStyles } from "./MergeCard.styles";
import type { MergeOption } from "./mergeOptions";

/**
 * Split button: run the selected method, or pick another behind ▾. While the
 * merge state is blocked or in conflict it stays runnable (the forge decides)
 * but quiet, so the card never reads "blocked, but press here".
 */
export function MergeMethodButton({
  action,
  muted,
  onRun,
  onSelectMethod,
  options,
  pending,
  selected,
}: {
  readonly action: ActionDescriptor;
  readonly muted: boolean;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly onSelectMethod: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly pending: boolean;
  readonly selected: MergeOption | null;
}): React.JSX.Element {
  return (
    <View style={mergeCardStyles.split}>
      <CatalogActionButton
        action={action}
        label={selected?.label ?? action.label}
        onPress={() => {
          onRun(action, selected?.value ?? null);
        }}
        pending={pending}
        variant={muted ? "quiet" : "secondary"}
      />
      {options.length > 1 ? (
        <MethodMenu onSelect={onSelectMethod} options={options} selected={selected} />
      ) : null}
    </View>
  );
}

function MethodMenu({
  onSelect,
  options,
  selected,
}: {
  readonly onSelect: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly selected: MergeOption | null;
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Merge method"
      actions={options.map((option) => ({
        id: option.value,
        label: option.label,
        selected: option.value === selected?.value,
      }))}
      onSelect={onSelect}
    >
      <Pressable
        accessibilityLabel="Merge method"
        accessibilityRole="button"
        style={mergeCardStyles.splitToggle}
      >
        <Ionicons color={colors.text} name="chevron-down" size={iconSize.inline} />
      </Pressable>
    </ActionMenu>
  );
}
