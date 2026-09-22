import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing } from "../../theme";

const DIALOG_MAX_WIDTH = 420;

interface AppModalDialogProps {
  readonly children: ReactNode;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly dismissOnBackdrop?: boolean;
  readonly onDismiss: () => void;
  readonly open: boolean;
  readonly testID?: string;
}

/** Centered application dialog with one modal and backdrop owner. */
export function AppModalDialog(props: AppModalDialogProps): React.JSX.Element | null {
  const { children, contentStyle, dismissOnBackdrop = true, onDismiss, open, testID } = props;
  if (!open) {
    return null;
  }
  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible>
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Close dialog"
          accessibilityRole="button"
          disabled={!dismissOnBackdrop}
          onPress={onDismiss}
          style={styles.backdrop}
        />
        <View accessibilityViewIsModal style={[styles.content, contentStyle]} testID={testID}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: colors.scrim,
    inset: 0,
    position: "absolute",
  },
  content: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.large,
    borderWidth: 1,
    maxHeight: "100%",
    maxWidth: DIALOG_MAX_WIDTH,
    padding: spacing.md,
    width: "100%",
  },
  root: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
});
