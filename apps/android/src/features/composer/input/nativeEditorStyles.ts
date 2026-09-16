import { StyleSheet } from "react-native";
import type { MarkdownTextInputStyle } from "react-native-enriched-markdown";
import { colors, radii, spacing, touchTarget, typeScale } from "../../../theme";
import { productFonts } from "../../../ui/product-fonts";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minHeight: touchTarget,
    minWidth: 0,
    overflow: "visible",
    position: "relative",
  },
  suggestionMenu: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
    bottom: "100%",
    elevation: 8,
    left: 0,
    marginBottom: spacing.optical,
    overflow: "hidden",
    padding: 0,
    position: "absolute",
    right: 0,
    zIndex: 1,
  },
  // The native editor owns intrinsic content height up to the caller's
  // maxHeight. A column-axis flex basis of zero would pin it to one line.
  input: {
    alignSelf: "stretch",
    color: colors.text,
    flexBasis: "auto",
    flexGrow: 0,
    flexShrink: 1,
    fontFamily: productFonts.regular,
    minHeight: touchTarget,
    minWidth: 0,
    width: "100%",
  },
});

export const markdownStyle = {
  em: { color: colors.text },
  h1: { color: colors.text, fontSize: typeScale.heading.fontSize },
  h2: { color: colors.text, fontSize: typeScale.title.fontSize },
  h3: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h4: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h5: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
  h6: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
  link: { backgroundColor: colors.accentMuted, color: colors.text, underline: false },
  spoiler: { backgroundColor: colors.surfaceContainerHigh, color: colors.text },
  strong: { color: colors.text },
} satisfies MarkdownTextInputStyle;
