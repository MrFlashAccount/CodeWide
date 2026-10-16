import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEvent } from "../react/useEvent";
import { colors, controlSize, iconSize, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";

const ACTION_PRESSED_OPACITY = 0.62;

interface CodeBlockHeaderProps {
  readonly copied: boolean;
  readonly language: string;
  readonly onCopy: () => void;
  readonly onOpenFullscreen: () => void;
  readonly scale: number;
}

/** The language may truncate; code actions must remain visible on narrow bubbles. */
export function CodeBlockHeader(props: CodeBlockHeaderProps) {
  const copy = useEvent(props.onCopy);
  const openFullscreen = useEvent(props.onOpenFullscreen);
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
      <Pressable
        accessibilityLabel={`${props.copied ? "Copied" : "Copy"} ${props.language} code block`}
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
        hitSlop={spacing.xs}
        onPress={copy}
        style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
      >
        <Ionicons
          color={props.copied ? colors.green : colors.textDim}
          name={props.copied ? "checkmark" : "copy-outline"}
          size={iconSize.inline}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="Open code block fullscreen"
        accessibilityRole="button"
        hitSlop={spacing.xs}
        onPress={openFullscreen}
        style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.textDim} name="expand-outline" size={iconSize.inline} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
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
  pressed: { opacity: ACTION_PRESSED_OPACITY },
  text: {
    color: colors.textDim,
    fontFamily: productFonts.regular,
  },
});
