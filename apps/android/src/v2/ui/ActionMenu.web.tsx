import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { useEvent } from "../../react/useEvent";
import { PresentationText as Text } from "../presentation/text/ProductText";
import type { ActionMenuItem, ActionMenuProps } from "./ActionMenu.types";

export type { ActionMenuItem } from "./ActionMenu.types";

export function ActionMenu(props: ActionMenuProps): React.JSX.Element {
  const { actions, children, onOpenChange, onSelect, style } = props;
  const [open, setOpen] = useState(false);
  const setVisible = useEvent((visible: boolean): void => {
    setOpen(visible);
    onOpenChange?.(visible);
  });
  const openMenu = useEvent(() => setVisible(true));
  const closeMenu = useEvent(() => setVisible(false));
  return (
    <View style={style}>
      <Pressable
        accessibilityLabel={children.props.accessibilityLabel ?? props.accessibilityLabel}
        {...(props.trigger === "long-press" ? { onLongPress: openMenu } : { onPress: openMenu })}
      >
        {children}
      </Pressable>
      <Modal animationType="fade" onRequestClose={closeMenu} transparent visible={open}>
        <Pressable accessibilityLabel="Dismiss menu" onPress={closeMenu} style={styles.backdrop}>
          <View style={styles.menu}>
            {actions.map((action) => (
              <ActionMenuRow
                key={action.id}
                action={action}
                close={closeMenu}
                onSelect={onSelect}
              />
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

interface ActionMenuRowProps {
  action: ActionMenuItem;
  close(): void;
  onSelect(id: string): void;
}

function ActionMenuRow(props: ActionMenuRowProps): React.JSX.Element {
  const { action, close, onSelect } = props;
  const select = useEvent((): void => {
    if (action.disabled === true) return;
    if (action.keepOpen !== true) close();
    onSelect(action.id);
  });
  return (
    <Pressable disabled={action.disabled} onPress={select} style={styles.row}>
      <Text style={[styles.label, action.destructive === true && styles.danger]}>
        {action.label}
      </Text>
      {action.description === undefined ? null : (
        <Text style={styles.description}>{action.description}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "flex-end",
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: "flex-start",
    padding: spacing.md,
  },
  danger: { color: colors.red },
  description: { color: colors.textMuted, ...typeScale.label },
  label: { color: colors.text, ...typeScale.body },
  menu: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.menu,
    minWidth: 264,
    overflow: "hidden",
    paddingVertical: spacing.xs,
  },
  row: { minHeight: 50, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
