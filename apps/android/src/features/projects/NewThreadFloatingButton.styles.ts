import { StyleSheet } from "react-native";
import { colors, radii, spacing } from "../../theme";

export const styles = StyleSheet.create({
  newThreadFab: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    bottom: spacing.md,
    elevation: 3,
    height: 56,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    width: 56,
    zIndex: 10,
  },
  pressed: { opacity: 0.68 },
});
