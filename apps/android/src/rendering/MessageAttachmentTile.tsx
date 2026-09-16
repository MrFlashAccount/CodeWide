import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, controlSize, layoutSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";

interface MessageAttachmentTileProps {
  readonly bytes?: number;
  readonly icon: ReactNode;
  readonly label: string;
  readonly name: string;
  onOpen?: () => void;
}

interface MessageAttachmentGridProps {
  readonly children: ReactNode;
}

/** At most two fixed-width tiles; Yoga wraps them when the bubble is narrower. */
export function MessageAttachmentGrid(props: MessageAttachmentGridProps) {
  return (
    <View style={styles.grid} testID="message-attachment-grid">
      {props.children}
    </View>
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
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    maxWidth: layoutSize.attachmentTile * 2 + spacing.xs,
    minWidth: 0,
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
    borderRadius: radii.small,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xs,
    maxWidth: "100%",
    minHeight: controlSize.touch,
    padding: spacing.xs,
    width: layoutSize.attachmentTile,
  },
});
