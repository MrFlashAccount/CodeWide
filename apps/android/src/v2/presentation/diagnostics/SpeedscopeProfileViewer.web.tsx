import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../../theme";
import { ProductText } from "../text/ProductText";
import type { SpeedscopeProfileViewerProps } from "./SpeedscopeProfileViewer.native";

export function SpeedscopeProfileViewer(props: SpeedscopeProfileViewerProps): React.JSX.Element {
  const { onClose } = props;
  return (
    <View style={styles.root}>
      <ProductText tone="muted">
        The bundled Speedscope viewer is available in the Android app.
      </ProductText>
      <Pressable
        accessibilityLabel="Close performance profile"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.button}
      >
        <ProductText>Close</ProductText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colors.surfaceRaised, borderRadius: radii.small, padding: spacing.sm },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
  },
});
