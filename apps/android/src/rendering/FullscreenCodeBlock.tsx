import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import {
  colors,
  controlSize,
  iconSize,
  layoutSize,
  spacing,
  typeScale,
  typeWeight,
} from "../theme";
import { AppText as Text } from "../ui/Typography";
import { NativeCodeBlock } from "./NativeCodeBlock";
import type { NativeCodeVariant } from "./native-code-block";
import { useCopyFeedback } from "./useCopyFeedback";

const PRESSED_OPACITY = 0.62;

export function FullscreenCodeBlock({
  language,
  onClose,
  value,
  variant = "code",
}: {
  readonly language: string;
  readonly onClose: () => void;
  readonly value: string;
  readonly variant?: NativeCodeVariant;
}): ReactElement {
  const [copied, copy] = useCopyFeedback(value);
  const [viewportHeight, setViewportHeight] = useState(0);
  const close = useEvent(onClose);
  const captureViewportHeight = useEvent(
    ({ nativeEvent }: { nativeEvent: { layout: { height: number } } }) => {
      const nextHeight = Math.max(0, Math.floor(nativeEvent.layout.height));
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    },
  );
  return (
    <View style={styles.root} testID="fullscreen-code-block">
      <FullscreenCodeBlockHeader
        copied={copied}
        language={language}
        onClose={close}
        onCopy={copy}
      />
      <View onLayout={captureViewportHeight} style={styles.viewport}>
        {viewportHeight > 0 && (
          <NativeCodeBlock
            embeddedInParentScroll={false}
            fillAvailableWidth
            language={language}
            maxHeight={viewportHeight}
            truncate={false}
            value={value}
            variant={variant}
          />
        )}
      </View>
    </View>
  );
}

function FullscreenCodeBlockHeader({
  copied,
  language,
  onClose,
  onCopy,
}: {
  readonly copied: boolean;
  readonly language: string;
  readonly onClose: () => void;
  readonly onCopy: () => void;
}): ReactElement {
  return (
    <View style={styles.header}>
      <IconButton accessibilityLabel="Close code block" icon="close" onPress={onClose} />
      <View style={styles.title}>
        <Text numberOfLines={1} style={styles.language}>
          {language}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          Code block
        </Text>
      </View>
      <IconButton
        accessibilityLabel={copied ? "Copied code block" : "Copy code block"}
        color={copied ? colors.green : colors.text}
        icon={copied ? "checkmark" : "copy-outline"}
        live={copied}
        onPress={onCopy}
      />
    </View>
  );
}

function IconButton({
  accessibilityLabel,
  color = colors.text,
  icon,
  live = false,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly color?: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly live?: boolean;
  readonly onPress: () => void;
}): ReactElement {
  const press = useEvent(onPress);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={live ? "polite" : "none"}
      accessibilityRole="button"
      onPress={press}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons color={color} name={icon} size={iconSize.navigation} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xs,
  },
  language: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
  },
  pressed: { opacity: PRESSED_OPACITY },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  title: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  viewport: {
    backgroundColor: colors.code,
    flex: 1,
    minHeight: 0,
    padding: spacing.xs,
  },
});
