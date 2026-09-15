import { StyleSheet } from "react-native";
import type { MarkdownTextInputStyle } from "react-native-enriched-markdown";
import { colors, radii, touchTarget, typeScale } from "../../../theme";
import { productFonts } from "../../../ui/product-fonts";

export const styles = StyleSheet.create({
  // The editor participates in row layout but does not form the anchor's
  // containing block. The outer composer shell therefore owns popup width.
  root: {
    position: "static",
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    minHeight: touchTarget,
    overflow: "visible",
  },
  popoverRoot: { position: "static" },
  suggestionAnchor: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  suggestionPopover: {
    padding: 0,
    elevation: 8,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.composer,
    overflow: "hidden",
  },
  // The native editor owns intrinsic content height up to the caller's
  // maxHeight. A column-axis flex basis of zero would pin it to one line.
  input: {
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    width: "100%",
    minHeight: touchTarget,
    color: colors.text,
    fontFamily: productFonts.regular,
  },
});

export const markdownStyle = {
  strong: { color: colors.text },
  em: { color: colors.text },
  link: { color: colors.text, backgroundColor: colors.accentMuted, underline: false },
  spoiler: { color: colors.text, backgroundColor: colors.surfaceContainerHigh },
  h1: { color: colors.text, fontSize: typeScale.heading.fontSize },
  h2: { color: colors.text, fontSize: typeScale.title.fontSize },
  h3: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h4: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h5: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
  h6: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
} satisfies MarkdownTextInputStyle;
