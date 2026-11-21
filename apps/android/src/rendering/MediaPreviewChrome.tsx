import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import {
  controlSize,
  iconSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../theme";
import { AppText as Text } from "../ui/Typography";
import { mediaPreviewButtonStyle, type MediaChrome } from "./mediaPreviewChromeState";

/** Close button, the media's title and trailing actions, all one control tall. */
export function MediaPreviewTopBar({
  children,
  chrome,
  closeLabel,
  onClose,
  testID,
  title,
  top,
}: {
  readonly children?: ReactNode;
  readonly chrome: MediaChrome;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly testID: string;
  readonly title: string;
  readonly top: number;
}): React.JSX.Element {
  const fade = useAnimatedStyle(() => ({ opacity: chrome.opacity.get() }));
  return (
    <Animated.View
      pointerEvents={chrome.visible ? "box-none" : "none"}
      style={[styles.topBar, { top }, fade]}
      testID={testID}
    >
      <Pressable
        accessibilityLabel={closeLabel}
        accessibilityRole="button"
        onPress={onClose}
        style={mediaPreviewButtonStyle}
      >
        <Ionicons color="#ffffff" name="close" size={iconSize.navigation} />
      </Pressable>
      <View style={styles.titlePill} testID="media-preview-title">
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.titleText}>
          {title}
        </Text>
      </View>
      {children === undefined ? <View style={styles.spacer} /> : children}
    </Animated.View>
  );
}

/** "2 / 5" under a gallery; a single item has no position to show. */
export function MediaPreviewPosition({
  bottom,
  chrome,
  count,
  index,
}: {
  readonly bottom: number;
  readonly chrome: MediaChrome;
  readonly count: number;
  readonly index: number;
}): React.JSX.Element | null {
  const fade = useAnimatedStyle(() => ({ opacity: chrome.opacity.get() }));
  if (count <= 1) {
    return null;
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.positionRow, { bottom }, fade]}
      testID="media-preview-position"
    >
      <View style={styles.positionBadge}>
        <Text style={styles.positionText}>
          {index + 1} / {count}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  positionBadge: {
    backgroundColor: "rgba(36,36,36,0.82)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  positionRow: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  positionText: {
    color: "#ffffff",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  spacer: {
    height: touchTarget,
    width: touchTarget,
  },
  titlePill: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.82)",
    borderRadius: radii.pill,
    flex: 1,
    height: touchTarget,
    justifyContent: "center",
    marginHorizontal: spacing.sm,
    minWidth: controlSize.compact,
    paddingHorizontal: spacing.md,
  },
  titleText: {
    color: "#ffffff",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
});
