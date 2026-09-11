import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import type { ComposerUploadState } from "../data/composer-uploads";
import { colors, iconSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";

export interface AttachmentCardProps {
  readonly name: string;
  readonly label: string;
  readonly uri?: string | null;
  readonly excerpt?: string | null;
  readonly bytes?: number;
  readonly state?: ComposerUploadState;
  readonly compact?: boolean;
  readonly video?: boolean;
  onOpen?(): void;
  onRemove?(): void;
  onRetry?(): void;
  onThumbnailError?(): void;
}

/** Shared file-card presentation; the caller owns upload and viewer capabilities. */
export function AttachmentCard(props: AttachmentCardProps) {
  const state = props.state;
  const busy = state?.status === "uploading";
  const failed = state?.status === "error";
  const progress = busy ? state.progress : null;
  const percent = progress === null || progress.total <= 0 ? null : Math.max(0, Math.min(100, Math.floor(progress.transferred / progress.total * 100)));
  const phase = progress === null ? "Preparing" : uploadPhaseLabels[progress.phase];
  const subtitle = failed ? "Upload failed"
    : busy ? `${phase}${percent === null ? "…" : ` · ${percent}%`}`
      : `${state?.status === "ready" ? "Ready" : props.label}${props.bytes === undefined ? "" : ` · ${formatAttachmentBytes(props.bytes)}`}`;
  return (
    <View style={[styles.card, props.compact && styles.compact]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${props.name}`} accessibilityHint={subtitle} disabled={props.onOpen === undefined} onPress={props.onOpen} style={styles.open}>
        <View style={styles.thumbnail}>
          {props.uri ? <Image source={{ uri: props.uri }} accessibilityLabel={props.name} resizeMode="cover" onError={props.onThumbnailError} style={styles.image} />
            : <Ionicons name={props.video ? "play-circle-outline" : "document-text-outline"} size={iconSize.action} color={colors.accent} />}
          {busy && <View style={styles.busy}><ActivityIndicator size="small" color={colors.accent} /></View>}
        </View>
        <View style={styles.details}>
          <Text numberOfLines={1} style={styles.name}>{props.name}</Text>
          {props.excerpt && <Text numberOfLines={2} style={styles.excerpt}>{props.excerpt}</Text>}
          <Text numberOfLines={2} style={[styles.subtitle, failed && styles.error]}>{subtitle}</Text>
          {failed && <Text numberOfLines={2} style={styles.subtitle}>{state.message}</Text>}
          {busy && percent !== null && <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${phase} ${props.name}`}
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={styles.progressTrack}
          ><View style={[styles.progressFill, { width: `${percent}%` }]} /></View>}
        </View>
      </Pressable>
      {failed && props.onRetry !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${props.name}`} onPress={props.onRetry} style={styles.action}><Ionicons name="refresh" size={iconSize.inline} color={colors.red} /></Pressable>}
      {props.onRemove !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${props.name}`} onPress={props.onRemove} style={styles.action}><Ionicons name="close" size={iconSize.inline} color={colors.textMuted} /></Pressable>}
    </View>
  );
}

const uploadPhaseLabels = { hashing: "Preparing", transferring: "Uploading", verifying: "Verifying" } as const;

function formatAttachmentBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.small, padding: spacing.xs, gap: spacing.xs, minWidth: 0, alignSelf: "stretch" },
  compact: { width: 260 },
  open: { flexDirection: "row", alignItems: "center", flex: 1, gap: spacing.xs, minWidth: 0 },
  thumbnail: { width: 56, height: 56, borderRadius: radii.compact, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLowest },
  image: { width: "100%", height: "100%" },
  busy: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.scrim },
  details: { flex: 1, gap: spacing.optical, minWidth: 0 },
  name: { ...typeScale.label, color: colors.text },
  excerpt: { ...typeScale.caption, color: colors.textMuted },
  subtitle: { ...typeScale.caption, color: colors.textMuted },
  error: { color: colors.red },
  progressTrack: { height: 3, borderRadius: radii.pill, overflow: "hidden", backgroundColor: colors.surfaceContainerHighest, marginTop: spacing.optical },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  action: { minWidth: touchTarget, minHeight: touchTarget, alignItems: "center", justifyContent: "center" },
});
