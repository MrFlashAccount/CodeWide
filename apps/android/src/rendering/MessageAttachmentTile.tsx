import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, controlSize, layoutSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { TwoRowHorizontalScroller } from "./TwoRowHorizontalScroller";

interface MessageAttachmentTileProps {
  readonly bytes?: number;
  readonly icon: ReactNode;
  readonly label: string;
  readonly name: string;
  onOpen?: () => void;
}

interface MessageAttachmentGridProps {
  readonly children: readonly ReactElement[];
  readonly style?: StyleProp<ViewStyle>;
}

/** Shows at most two attachment rows while additional columns scroll horizontally. */
export function MessageAttachmentGrid(props: MessageAttachmentGridProps) {
  return (
    <TwoRowHorizontalScroller
      items={props.children}
      style={[styles.grid, props.style]}
      testID="message-attachment-grid"
    />
  );
}

export function MessageAttachmentTile(props: MessageAttachmentTileProps) {
  const subtitle =
    props.bytes === undefined ? props.label : `${props.label} · ${formatBytes(props.bytes)}`;
  return (
    <Pressable
      accessibilityLabel={`Open ${props.name}`}
      accessibilityRole="button"
      disabled={props.onOpen === undefined}
      onPress={props.onOpen}
      style={styles.tile}
    >
      {props.icon}
      <View style={styles.details}>
        <Text
          ellipsizeMode="middle"
          maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={1}
          style={styles.name}
        >
          {props.name}
        </Text>
        <Text
          maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={1}
          style={styles.subtitle}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${String(Math.ceil(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  details: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  grid: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: 0,
    width: layoutSize.attachmentTile,
  },
  name: {
    ...typeScale.label,
    color: colors.text,
    fontFamily: productFonts.medium,
    fontWeight: typeWeight.regular,
  },
  subtitle: {
    ...typeScale.caption,
    color: colors.textMuted,
    fontFamily: productFonts.regular,
    fontWeight: typeWeight.regular,
  },
  tile: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.selected,
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
    maxWidth: "100%",
    minHeight: controlSize.touch,
    padding: spacing.xs,
    width: layoutSize.attachmentTile,
  },
});
