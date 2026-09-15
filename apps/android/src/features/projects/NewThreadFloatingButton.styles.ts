import { StyleSheet } from "react-native";
import { colors, radii, spacing } from "../../theme";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  newThreadFab: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    width: 56,
    height: 56,
    borderRadius: radii.large,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    zIndex: 10,
    elevation: 3,
  },
});
