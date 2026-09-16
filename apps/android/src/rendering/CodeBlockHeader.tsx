import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";

interface CodeBlockHeaderProps {
  readonly copied: boolean;
  readonly language: string;
  readonly scale: number;
}

/** The language may truncate; the copy action must remain visible on narrow bubbles. */
export function CodeBlockHeader(props: CodeBlockHeaderProps) {
  const typography = {
    fontSize: typeScale.caption.fontSize * props.scale,
    lineHeight: typeScale.caption.lineHeight * props.scale,
  };
  return (
    <View style={styles.header}>
      <Text
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={[styles.text, styles.language, typography]}
      >
        {props.language}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={[styles.text, styles.action, typography, props.copied && styles.copied]}
      >
        {props.copied ? "Copied" : "Copy"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { flexShrink: 0 },
  copied: { color: colors.green },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  language: {
    flex: 1,
    minWidth: 0,
    textTransform: "uppercase",
  },
  text: {
    color: colors.textDim,
    fontFamily: productFonts.regular,
  },
});
