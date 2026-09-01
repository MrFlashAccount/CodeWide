import { useState } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { PresentationSheetView } from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import type { ServerRailRow } from "./ServerRailView";

interface ServerSelectorViewProps {
  activeId?: string;
  detail?: string;
  heading?: string;
  onAdd(): void;
  onOpenAll(): void;
  onOpen(id: string): void;
  onSettings(): void;
  rows: ServerRailRow[];
}

interface ServerSelectorRowProps {
  onOpen(id: string): void;
  row: ServerRailRow;
  selected: boolean;
}

interface SelectorActionProps {
  detail: string;
  icon: PresentationIconName;
  label: string;
  onPress(): void;
}

export function ServerSelectorView({
  activeId,
  detail,
  heading,
  onAdd,
  onOpenAll,
  onOpen,
  onSettings,
  rows,
}: ServerSelectorViewProps): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  const show = useEvent((): void => {
    setVisible(true);
  });
  const hide = useEvent((): void => {
    setVisible(false);
  });
  const open = useEvent((id: string): void => {
    setVisible(false);
    onOpen(id);
  });
  const add = useEvent((): void => {
    setVisible(false);
    onAdd();
  });
  const openAll = useEvent((): void => {
    setVisible(false);
    onOpenAll();
  });
  const settings = useEvent((): void => {
    setVisible(false);
    onSettings();
  });
  const handleOpenChange = useEvent((openState: boolean): void => {
    if (!openState) hide();
  });
  const selectedLabel =
    activeId === undefined
      ? "All servers"
      : (rows.find((row) => row.id === activeId)?.label ?? "Server");
  return (
    <>
      <Pressable
        accessibilityLabel="Choose server"
        accessibilityRole="button"
        onPress={show}
        style={selectorButtonStyle}
      >
        <View style={styles.selectorCopy}>
          <ProductText
            accessibilityRole={heading === undefined ? undefined : "header"}
            numberOfLines={1}
            style={heading === undefined ? styles.selectorLabel : styles.selectorHeading}
            tone={heading === undefined ? "muted" : "default"}
            weight={heading === undefined ? "regular" : "semibold"}
          >
            {heading ?? selectedLabel}
          </ProductText>
          {detail === undefined ? null : (
            <ProductText numberOfLines={1} style={styles.selectorDetail} tone="muted">
              {detail}
            </ProductText>
          )}
        </View>
        <ProductText style={styles.selectorChevron} tone="muted">
          ⌄
        </ProductText>
      </Pressable>
      <PresentationSheetView
        contentProps={{ enableDynamicSizing: true, index: 0 }}
        isOpen={visible}
        onOpenChange={handleOpenChange}
      >
        <ProductText style={styles.sheetTitle} weight="semibold">
          Server
        </ProductText>
        <Pressable
          accessibilityLabel={`All servers${activeId === undefined ? ", selected" : ""}`}
          accessibilityRole="button"
          accessibilityState={{ selected: activeId === undefined }}
          onPress={openAll}
          style={activeId === undefined ? selectedOptionStyle : optionStyle}
        >
          <ProductText numberOfLines={2} style={styles.optionTitle}>
            All servers
          </ProductText>
          <PresentationIcon
            color={activeId === undefined ? colors.accent : colors.textDim}
            name={activeId === undefined ? "checkCircle" : "radio"}
            size={20}
          />
        </Pressable>
        {rows.map((row) => (
          <ServerSelectorRow key={row.id} onOpen={open} row={row} selected={row.id === activeId} />
        ))}
        <SelectorAction detail="Pair another host" icon="add" label="Add server" onPress={add} />
        <SelectorAction
          detail="Servers, accounts, and limits"
          icon="settings"
          label="Settings"
          onPress={settings}
        />
      </PresentationSheetView>
    </>
  );
}

function ServerSelectorRow({ onOpen, row, selected }: ServerSelectorRowProps): React.JSX.Element {
  const open = useEvent((): void => {
    onOpen(row.id);
  });
  return (
    <Pressable
      accessibilityLabel={`${row.label}, ${row.detail}${selected ? ", selected" : ""}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={open}
      style={selected ? selectedOptionStyle : optionStyle}
    >
      <View style={styles.optionCopy}>
        <ProductText numberOfLines={2} style={styles.optionTitle}>
          <ProductText style={styles.emoji}>{row.emoji}</ProductText> {row.label}
        </ProductText>
        <ProductText numberOfLines={2} style={styles.optionDetail} tone="muted">
          {row.detail}
        </ProductText>
      </View>
      <PresentationIcon
        color={selected ? colors.accent : colors.textDim}
        name={selected ? "checkCircle" : "radio"}
        size={20}
      />
    </Pressable>
  );
}

function SelectorAction({ detail, icon, label, onPress }: SelectorActionProps): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={actionStyle}>
      <View style={styles.actionIcon}>
        <PresentationIcon color={colors.textMuted} name={icon} size={21} />
      </View>
      <View style={styles.actionCopy}>
        <ProductText numberOfLines={1} style={styles.actionTitle}>
          {label}
        </ProductText>
        <ProductText numberOfLines={2} style={styles.actionDetail} tone="muted">
          {detail}
        </ProductText>
      </View>
      <PresentationIcon color={colors.textDim} name="forward" size={18} />
    </Pressable>
  );
}

function selectorButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.selector, pressed && styles.pressed];
}

function optionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.option, pressed && styles.pressed];
}

function selectedOptionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.option, styles.optionSelected, pressed && styles.pressed];
}

function actionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  actionDetail: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  actionIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  actionTitle: typeScale.titleMedium,
  emoji: { fontSize: 22, lineHeight: 28 },
  option: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  optionCopy: { flex: 1, minWidth: 0 },
  optionDetail: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  optionSelected: { backgroundColor: colors.primaryContainer },
  optionTitle: { flex: 1, ...typeScale.titleMedium },
  pressed: { opacity: 0.68 },
  selector: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "100%",
    minHeight: touchTarget,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.medium,
  },
  selectorCopy: { flexShrink: 1, minWidth: 0 },
  selectorDetail: { fontSize: 12, lineHeight: 16 },
  selectorChevron: { fontSize: 13, lineHeight: 16 },
  selectorHeading: { fontSize: 22, lineHeight: 28 },
  selectorLabel: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  sheetTitle: { flexShrink: 1, minWidth: 0, ...typeScale.titleLarge },
});
