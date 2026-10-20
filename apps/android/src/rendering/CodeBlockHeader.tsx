import { Ionicons } from "@expo/vector-icons";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEvent } from "../react/useEvent";
import { colors, controlHitSlop, controlSize, iconSize, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { richMarkdownGeometry } from "./richMarkdownGeometry";

interface CodeBlockHeaderProps {
  readonly copied: boolean;
  readonly language: string;
  readonly onCopy: () => void;
  readonly onOpenFullscreen: () => void;
  readonly scale: number;
}

const PRESSED_OPACITY = 0.62;

/** The language may truncate; the copy action must remain visible on narrow bubbles. */
export function CodeBlockHeader(props: CodeBlockHeaderProps): ReactElement {
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
      <CodeBlockAction
        accessibilityLabel={
          props.copied ? `Copied ${props.language} code block` : `Copy ${props.language} code block`
        }
        color={props.copied ? colors.green : colors.textDim}
        icon={props.copied ? "checkmark" : "copy-outline"}
        live={props.copied}
        onPress={copy}
      />
      <CodeBlockAction
        accessibilityLabel="Open code block fullscreen"
        color={colors.textDim}
        icon="expand-outline"
        onPress={openFullscreen}
      />
    </View>
  );
}

function CodeBlockAction({
  accessibilityLabel,
  color,
  icon,
  live = false,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly color: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly live?: boolean;
  readonly onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={live ? "polite" : "none"}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons color={color} name={icon} size={iconSize.inline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
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
    minHeight: richMarkdownGeometry.codeHeaderHeight,
  },
  language: {
    flex: 1,
    marginRight: spacing.xxs,
    minWidth: 0,
    textTransform: "uppercase",
  },
  pressed: { opacity: PRESSED_OPACITY },
  text: {
    color: colors.textDim,
    fontFamily: productFonts.regular,
  },
});
