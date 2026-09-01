import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../../theme";
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

export function ActionSheetView({
  items,
  onClose,
  onSelect,
  title,
  visible,
}: ActionSheetViewProps): React.JSX.Element {
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

function ActionSheetRow({ item, onSelect }: ActionSheetRowProps): React.JSX.Element {
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

function closeStyle({ pressed }: PressableStateCallbackType) {
  return [styles.close, pressed && styles.pressed];
}

function rowStyle({ pressed }: PressableStateCallbackType) {
  return [styles.row, pressed && styles.pressed];
}

function selectedRowStyle({ pressed }: PressableStateCallbackType) {
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
  detail: { fontSize: 12, lineHeight: 16, marginTop: 1 },
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
  label: { fontSize: 15, lineHeight: 21 },
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
  title: { flex: 1, fontSize: 22, lineHeight: 28 },
});
