import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
} from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";

export interface ActionSheetItem {
  detail?: string;
  disabled?: boolean;
  icon: PresentationIconName;
  id: string;
  label: string;
  selected?: boolean;
}

interface ActionSheetViewProps {
  items: ActionSheetItem[];
  onClose(): void;
  onSelect(id: string): void;
  title: string;
  visible: boolean;
}

interface ActionSheetRowProps {
  item: ActionSheetItem;
  onSelect(id: string): void;
}

export function ActionSheetView(props: ActionSheetViewProps): React.JSX.Element {
  const { items, onClose, onSelect, title, visible } = props;
  const handleOpenChange = useEvent((isOpen: boolean) => {
    if (!isOpen) onClose();
  });
  return (
    <PresentationSheetView
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen={visible}
      onOpenChange={handleOpenChange}
    >
      <View style={styles.header}>
        <ProductText style={styles.title} weight="semibold">
          {title}
        </ProductText>
        <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={closeStyle}>
          <PresentationIcon color={colors.text} name="close" size={22} />
        </Pressable>
      </View>
      <PresentationSheetScrollView contentContainerStyle={styles.content}>
        {items.map((item) => (
          <ActionSheetRow item={item} key={item.id} onSelect={onSelect} />
        ))}
      </PresentationSheetScrollView>
    </PresentationSheetView>
  );
}

function ActionSheetRow(props: ActionSheetRowProps): React.JSX.Element {
  const { item, onSelect } = props;
  const select = useEvent(() => onSelect(item.id));
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: item.disabled === true }}
      disabled={item.disabled}
      onPress={select}
      style={item.selected === true ? selectedRowStyle : rowStyle}
    >
      <View style={styles.icon}>
        <PresentationIcon color={colors.text} name={item.icon} size={21} />
      </View>
      <View style={styles.copy}>
        <ProductText style={styles.label} weight="semibold">
          {item.label}
        </ProductText>
        {item.detail === undefined ? null : (
          <ProductText style={styles.detail} tone="muted">
            {item.detail}
          </ProductText>
        )}
      </View>
    </Pressable>
  );
}

function closeStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.close, pressed && styles.pressed];
}

function rowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, pressed && styles.pressed];
}

function selectedRowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, styles.rowSelected, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: { gap: spacing.xxs, padding: spacing.sm, paddingBottom: spacing.lg },
  copy: { flex: 1, minWidth: 0 },
  detail: { ...typeScale.label, marginTop: spacing.optical },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 64,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  icon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  label: { ...typeScale.body },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rowSelected: { backgroundColor: colors.secondaryContainer },
  title: { flex: 1, ...typeScale.heading },
});
