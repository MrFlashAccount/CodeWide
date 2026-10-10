import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";

const PRESSED_OPACITY = 0.68;

export const styles = StyleSheet.create({
  bubbleNestedSurface: {
    backgroundColor: "transparent",
    paddingBottom: 0,
    paddingTop: 0,
  },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  detail: {
    color: colors.textMuted,
    minWidth: 0,
    paddingLeft: spacing.compact + iconSize.inline,
    ...typeScale.caption,
  },
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.compact,
    minWidth: 0,
  },
  meta: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.caption,
  },
  pressed: { opacity: PRESSED_OPACITY },
  title: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  titleWave: {
    alignSelf: "center",
    justifyContent: "center",
  },
});
