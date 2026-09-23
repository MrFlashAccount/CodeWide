import { StyleSheet } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";

const CONTENT_MAX_WIDTH = 440;
const ATMOSPHERE_MAX_WIDTH = 890;
const TITLE_FONT_SIZE = 28;
const TITLE_LINE_HEIGHT = 34;
const TITLE_TRACKING = -0.7;

export const styles = StyleSheet.create({
  atmosphere: {
    alignSelf: "center",
    bottom: 0,
    maxWidth: ATMOSPHERE_MAX_WIDTH,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget + spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  buttonLabel: {
    color: "#111216",
    ...typeScale.title,
  },
  buttonPressed: {
    backgroundColor: colors.accentPressed,
  },
  content: {
    alignSelf: "center",
    maxWidth: CONTENT_MAX_WIDTH,
    paddingBottom: spacing.xl + spacing.md,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  description: {
    color: "#a7aab4",
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.heading.lineHeight,
    marginBottom: spacing.xl + spacing.xl,
    textAlign: "center",
  },
  hint: {
    color: "#8e929e",
    ...typeScale.label,
    marginTop: spacing.lg,
    textAlign: "center",
  },
  root: {
    backgroundColor: "#111216",
    flex: 1,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  title: {
    color: colors.text,
    fontSize: TITLE_FONT_SIZE,
    fontWeight: typeWeight.semibold,
    letterSpacing: TITLE_TRACKING,
    lineHeight: TITLE_LINE_HEIGHT,
    marginBottom: spacing.md,
    textAlign: "center",
  },
});
