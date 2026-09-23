import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";

const MIN_MENU_DIMENSION = 1;

/** Centered React Native fallback; Android resolves to the anchored Compose shell. */
export function ContentMenu(props: ContentMenuProps): React.JSX.Element {
  const window = useWindowDimensions();
  const close = useEvent(() => {
    props.onOpenChange(false);
  });
  const width = Math.min(
    props.width,
    Math.max(MIN_MENU_DIMENSION, window.width - spacing.md - spacing.md),
  );

  return (
    <View collapsable={false}>
      {props.trigger}
      <ContentMenuModal
        close={close}
        content={props.children}
        maxHeight={Math.max(MIN_MENU_DIMENSION, window.height - spacing.lg)}
        open={props.open}
        width={width}
      />
    </View>
  );
}

function ContentMenuModal({
  close,
  content,
  maxHeight,
  open,
  width,
}: {
  readonly close: () => void;
  readonly content: React.ReactNode;
  readonly maxHeight: number;
  readonly open: boolean;
  readonly width: number;
}): React.JSX.Element {
  return (
    <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
      <View style={styles.modalRoot}>
        <MenuBackdrop close={close} />
        <MenuContent content={content} maxHeight={maxHeight} width={width} />
      </View>
    </Modal>
  );
}

function MenuBackdrop({ close }: { readonly close: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel="Close menu"
      accessibilityRole="button"
      onPress={close}
      style={styles.backdrop}
    />
  );
}

function MenuContent({
  content,
  maxHeight,
  width,
}: {
  readonly content: React.ReactNode;
  readonly maxHeight: number;
  readonly width: number;
}): React.JSX.Element {
  return (
    <View style={[styles.content, { width }]}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight }}>
        {content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: colors.scrim,
    inset: 0,
    position: "absolute",
  },
  content: {
    backgroundColor: colors.menuSurface,
    borderColor: colors.borderSoft,
    borderRadius: radii.menu,
    borderWidth: 1,
    overflow: "hidden",
  },
  modalRoot: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
});
