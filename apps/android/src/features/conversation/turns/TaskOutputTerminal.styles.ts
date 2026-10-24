import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

/**
 * The output fills the viewport in the code surface colour; the terminal
 * paints the same colour, so its inset reads as padding, not a frame.
 */
export const styles = StyleSheet.create({
  empty: {
    color: colors.textDim,
    ...typeScale.code,
  },
  error: {
    color: colors.red,
    padding: spacing.sm,
    ...typeScale.label,
  },
  omitted: {
    color: colors.textDim,
    marginBottom: spacing.xs,
    ...typeScale.label,
  },
  output: {
    color: colors.text,
    ...typeScale.code,
  },
  overlay: {
    left: spacing.sm,
    position: "absolute",
    top: spacing.sm,
  },
  terminal: {
    backgroundColor: colors.code,
    flex: 1,
  },
  terminalContent: {
    padding: spacing.sm,
  },
  terminalView: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
});
