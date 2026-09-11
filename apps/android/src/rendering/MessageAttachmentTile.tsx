import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, controlSize, layoutSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";

interface MessageAttachmentTileProps {
  readonly name: string;
  readonly label: string;
  readonly bytes?: number;
  readonly icon: ReactNode;
  onOpen?(): void;
}

interface MessageAttachmentGridProps { readonly children: ReactNode }

/** At most two fixed-width tiles; Yoga wraps them when the bubble is narrower. */
export function MessageAttachmentGrid(props: MessageAttachmentGridProps) {
  return <View testID="message-attachment-grid" style={styles.grid}>{props.children}</View>;
}

export function MessageAttachmentTile(props: MessageAttachmentTileProps) {
  const subtitle = props.bytes === undefined ? props.label : `${props.label} · ${formatBytes(props.bytes)}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${props.name}`} disabled={props.onOpen === undefined} onPress={props.onOpen} style={styles.tile}>
    {props.icon}
    <View style={styles.details}>
      <Text numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER} style={styles.name}>{props.name}</Text>
      <Text numberOfLines={1} maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER} style={styles.subtitle}>{subtitle}</Text>
    </View>
  </Pressable>;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", alignSelf: "flex-start", minWidth: 0, maxWidth: layoutSize.attachmentTile * 2 + spacing.xs, gap: spacing.xs },
  tile: { width: layoutSize.attachmentTile, maxWidth: "100%", minHeight: controlSize.touch, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.xs, borderRadius: radii.small, backgroundColor: colors.surfaceContainerHigh },
  details: { flex: 1, minWidth: 0, gap: spacing.optical },
  name: { ...typeScale.label, fontFamily: productFonts.medium, fontWeight: typeWeight.regular, color: colors.text },
  subtitle: { ...typeScale.caption, fontFamily: productFonts.regular, fontWeight: typeWeight.regular, color: colors.textMuted },
});
