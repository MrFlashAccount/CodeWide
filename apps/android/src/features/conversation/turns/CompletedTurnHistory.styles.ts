import { StyleSheet } from "react-native";
import { colors, controlSize, radii, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  agentPlaceholder: {
    color: colors.textDim,
    ...typeScale.label,
  },
  activityMoreButton: {
    minHeight: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerLow,
  },
  activityMoreText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
});
