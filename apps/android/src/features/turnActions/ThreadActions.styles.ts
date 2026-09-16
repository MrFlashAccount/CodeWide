import { StyleSheet } from "react-native";
import { colors, radii, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  headerMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
