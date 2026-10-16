import { Ionicons } from "@expo/vector-icons";
import { useState, type JSX } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, layoutSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { useFullscreenWindowReady } from "../ui/FullscreenWindowReady";
import { NativeCodeBlock } from "./NativeCodeBlock";

const PRESSED_OPACITY = 0.68;

export function FullscreenCodeBlock({
  language,
  onClose,
  onCopy,
  value,
}: {
  readonly language: string;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly value: string;
}): JSX.Element {
  const fullscreenReady = useFullscreenWindowReady();
  const [viewportHeight, setViewportHeight] = useState(0);
  const close = useEvent(onClose);
  const copy = useEvent(onCopy);
  const measureViewport = useEvent((event: LayoutChangeEvent) => {
    const nextHeight = Math.max(0, Math.floor(event.nativeEvent.layout.height));
    setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
  });

  return (
    <View style={styles.root} testID="fullscreen-code-block">
      <FullscreenCodeHeader language={language} onClose={close} onCopy={copy} />
      <FullscreenCodeViewport
        enabled={fullscreenReady}
        language={language}
        onLayout={measureViewport}
        value={value}
        viewportHeight={viewportHeight}
      />
    </View>
  );
}

function FullscreenCodeHeader({
  language,
  onClose,
  onCopy,
}: {
  readonly language: string;
  readonly onClose: () => void;
  readonly onCopy: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Close code block"
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
      </Pressable>
      <View style={styles.titleGroup}>
        <Text numberOfLines={1} style={styles.title}>
          {language}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          Code block
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Copy ${language} code block`}
        accessibilityRole="button"
        onPress={onCopy}
        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.text} name="copy-outline" size={iconSize.action} />
      </Pressable>
    </View>
  );
}

function FullscreenCodeViewport({
  enabled,
  language,
  onLayout,
  value,
  viewportHeight,
}: {
  readonly enabled: boolean;
  readonly language: string;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly value: string;
  readonly viewportHeight: number;
}) {
  const content =
    enabled && viewportHeight > 0 ? (
      Platform.OS === "android" ? (
        <NativeCodeBlock
          embeddedInParentScroll={false}
          language={language}
          maxHeight={viewportHeight}
          value={value}
        />
      ) : (
        <FullscreenCodeFallback value={value} />
      )
    ) : null;
  return (
    <View onLayout={onLayout} style={styles.viewport} testID="fullscreen-code-viewport">
      {content}
    </View>
  );
}

function FullscreenCodeFallback({ value }: { readonly value: string }) {
  return (
    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
      <ScrollView
        contentContainerStyle={styles.fallbackContent}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
      >
        <Text selectable style={styles.fallbackText}>
          {value}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fallbackContent: {
    flexGrow: 0,
    padding: spacing.sm,
  },
  fallbackText: {
    color: colors.textMuted,
    ...typeScale.code,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xs,
  },
  headerButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: PRESSED_OPACITY },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  viewport: {
    backgroundColor: colors.code,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
});
