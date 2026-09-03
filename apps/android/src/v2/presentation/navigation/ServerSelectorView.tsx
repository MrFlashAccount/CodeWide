import { useState, useTransition } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { PresentationSheetView } from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { ServerRailRow } from "./ServerRailView";

interface ServerSelectorViewProps {
  activeId?: string;
  detail?: string;
  error?: string;
  heading?: string;
  onAdd(): void;
  onOpenAll(): void;
  onOpen(id: string): void;
  onRetry?(): void | Promise<void>;
  onSettings(): void;
  rows: ServerRailRow[];
}

interface NewThreadServerPickerViewProps {
  isOpen: boolean;
  onAdd(): void;
  onOpenChange(open: boolean): void;
  onSelect(id: string): void;
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

export function ServerSelectorView(props: ServerSelectorViewProps): React.JSX.Element {
  const { activeId, detail, error, heading, onAdd, onOpenAll, onOpen, onRetry, onSettings, rows } =
    props;
  const [visible, setVisible] = useState(false);
  const [retryPending, startRetry] = useTransition();
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
  const retry = useEvent((): void => {
    if (onRetry === undefined || retryPending) return;
    startRetry(async () => {
      await onRetry();
    });
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
        <PresentationIcon color={colors.textMuted} name="chevronDown" size={17} />
      </Pressable>
      <PresentationSheetView
        contentProps={{ enableDynamicSizing: true, index: 0 }}
        isOpen={visible}
        onOpenChange={handleOpenChange}
      >
        <ProductText style={styles.sheetTitle} weight="semibold">
          Server
        </ProductText>
        {error === undefined ? null : (
          <View style={styles.errorRow}>
            <ProductText style={styles.errorCopy} tone="danger">
              {error}
            </ProductText>
            {onRetry === undefined ? null : (
              <Pressable
                accessibilityLabel="Retry loading servers"
                accessibilityRole="button"
                accessibilityState={{ busy: retryPending }}
                onPress={retry}
                style={actionStyle}
              >
                {retryPending ? (
                  <ShimmerText text="Try again" />
                ) : (
                  <ProductText weight="semibold">Try again</ProductText>
                )}
              </Pressable>
            )}
          </View>
        )}
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

export function NewThreadServerPickerView(
  props: NewThreadServerPickerViewProps,
): React.JSX.Element {
  const { isOpen, onAdd, onOpenChange, onSelect, rows } = props;
  const select = useEvent((id: string): void => {
    onOpenChange(false);
    onSelect(id);
  });
  const add = useEvent((): void => {
    onOpenChange(false);
    onAdd();
  });
  return (
    <PresentationSheetView
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <ProductText style={styles.sheetTitle} weight="semibold">
        Choose a server for the new thread
      </ProductText>
      {rows.length === 0 ? (
        <ProductText style={styles.emptyCopy} tone="muted">
          No enabled servers are available.
        </ProductText>
      ) : (
        rows.map((row) => (
          <ServerSelectorRow key={row.id} onOpen={select} row={row} selected={false} />
        ))
      )}
      <SelectorAction detail="Pair another host" icon="add" label="Add server" onPress={add} />
    </PresentationSheetView>
  );
}

function ServerSelectorRow(props: ServerSelectorRowProps): React.JSX.Element {
  const { onOpen, row, selected } = props;
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

function SelectorAction(props: SelectorActionProps): React.JSX.Element {
  const { detail, icon, label, onPress } = props;
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

function selectorButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.selector, pressed && styles.pressed];
}

function optionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.option, pressed && styles.pressed];
}

function selectedOptionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.option, styles.optionSelected, pressed && styles.pressed];
}

function actionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
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
  actionDetail: { ...typeScale.label, marginTop: spacing.optical },
  actionIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  actionTitle: typeScale.title,
  emptyCopy: { paddingVertical: spacing.sm },
  emoji: { ...typeScale.emoji },
  errorCopy: { flex: 1, minWidth: 0 },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  option: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  optionCopy: { flex: 1, minWidth: 0 },
  optionDetail: { ...typeScale.label, marginTop: spacing.optical },
  optionSelected: { backgroundColor: colors.primaryContainer },
  optionTitle: { flex: 1, ...typeScale.title },
  pressed: { opacity: 0.68 },
  selector: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    minHeight: touchTarget,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.medium,
  },
  selectorCopy: { flex: 1, minWidth: 0 },
  selectorDetail: { ...typeScale.label },
  selectorHeading: { ...typeScale.heading },
  selectorLabel: { flexShrink: 1, ...typeScale.label },
  sheetTitle: { flexShrink: 1, minWidth: 0, ...typeScale.heading },
});
