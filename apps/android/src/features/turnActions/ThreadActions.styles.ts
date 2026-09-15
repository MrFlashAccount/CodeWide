import { StyleSheet } from "react-native";
import { colors, radii, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  headerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.heading },
});
