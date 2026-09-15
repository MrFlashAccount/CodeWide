import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";

interface CodeBlockHeaderProps {
  readonly language: string;
  readonly copied: boolean;
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
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.3}
        style={[styles.text, styles.language, typography]}
      >
        {props.language}
      </Text>
      <Text
        numberOfLines={1}
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={1.3}
        style={[styles.text, styles.action, typography, props.copied && styles.copied]}
      >
        {props.copied ? "Copied" : "Copy"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  text: {
    color: colors.textDim,
    fontFamily: productFonts.regular,
  },
  language: {
    flex: 1,
    minWidth: 0,
    textTransform: "uppercase",
  },
  action: { flexShrink: 0 },
  copied: { color: colors.green },
});
