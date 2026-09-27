import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { serverIconOption, serverIconOptions, type ServerIconId } from "../../data/serverIcons";
import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../../theme";
import { ContentMenu } from "../../ui/ContentMenu";
import { ServerIcon } from "./ServerIcon";

const PICKER_COLUMNS = 4;
const PICKER_CELL_SIZE = touchTarget;
const PRESSED_OPACITY = 0.68;
const SELECTED_MARK_SIZE = 6;
const PICKER_WIDTH =
  PICKER_COLUMNS * PICKER_CELL_SIZE + (PICKER_COLUMNS - 1) * spacing.xs + spacing.sm + spacing.sm;

/** Anchored server-icon popover with one stable, accessible selection grid. */
export function ServerIconPicker({
  accessibilityLabel,
  iconId,
  onSelect,
}: {
  readonly accessibilityLabel: string;
  readonly iconId: ServerIconId;
  onSelect: (iconId: ServerIconId) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedIcon = serverIconOption(iconId);
  const openPicker = useEvent(() => {
    setOpen(true);
  });
  const setPickerOpen = useEvent((next: boolean) => {
    setOpen(next);
  });
  const trigger = (
    <Pressable
      accessibilityLabel={`${accessibilityLabel}. Selected: ${selectedIcon.label}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={openPicker}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="server-icon-picker-trigger"
    >
      <ServerIcon color={colors.text} iconId={iconId} metric="title" />
    </Pressable>
  );
  return (
    <ContentMenu onOpenChange={setPickerOpen} open={open} trigger={trigger} width={PICKER_WIDTH}>
      <View accessibilityLabel="Server icons" accessibilityRole="radiogroup" style={styles.grid}>
        {serverIconOptions.map((option) => (
          <ServerIconOption
            iconId={option.id}
            key={option.id}
            label={option.label}
            onSelect={onSelect}
            selected={option.id === iconId}
            setPickerOpen={setPickerOpen}
          />
        ))}
      </View>
    </ContentMenu>
  );
}

function ServerIconOption({
  iconId,
  label,
  onSelect,
  selected,
  setPickerOpen,
}: {
  readonly iconId: ServerIconId;
  readonly label: string;
  onSelect: (iconId: ServerIconId) => void;
  readonly selected: boolean;
  setPickerOpen: (open: boolean) => void;
}): React.JSX.Element {
  const select = useEvent(() => {
    onSelect(iconId);
    setPickerOpen(false);
  });
  return (
    <Pressable
      accessibilityLabel={`Server icon: ${label}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      onPress={select}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.pressed,
      ]}
      testID={`server-icon-option-${iconId}`}
    >
      <ServerIcon
        color={selected ? colors.text : colors.textMuted}
        iconId={iconId}
        metric="title"
      />
      {selected && <View pointerEvents="none" style={styles.selectedMark} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    padding: spacing.sm,
    width: PICKER_WIDTH,
  },
  option: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    height: PICKER_CELL_SIZE,
    justifyContent: "center",
    width: PICKER_CELL_SIZE,
  },
  optionSelected: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.textMuted,
  },
  pressed: { opacity: PRESSED_OPACITY },
  selectedMark: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: SELECTED_MARK_SIZE,
    position: "absolute",
    right: spacing.xxs,
    top: spacing.xxs,
    width: SELECTED_MARK_SIZE,
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
