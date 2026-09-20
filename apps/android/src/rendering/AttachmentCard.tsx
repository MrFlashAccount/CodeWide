import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import type { ComposerUploadState } from "../data/composer-uploads";
import { colors, iconSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { percentageDimension } from "../ui/percentageDimension";

export interface AttachmentCardProps {
  readonly bytes?: number;
  readonly compact?: boolean;
  readonly excerpt?: string | null;
  readonly icon?: ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly name: string;
  onOpen?: () => void;
  onRemove?: () => void;
  onRetry?: () => void;
  onThumbnailError?: () => void;
  readonly state?: ComposerUploadState;
  readonly testID?: string;
  readonly uri?: string | null;
  readonly video?: boolean;
}

/** Shared file-card presentation; the caller owns upload and viewer capabilities. */
export function AttachmentCard(props: AttachmentCardProps) {
  const state = props.state;
  const busy = state?.status === "uploading";
  const failed = state?.status === "error";
  const progress = busy ? state.progress : null;
  const percent =
    progress === null || progress.total <= 0
      ? null
      : Math.max(0, Math.min(100, Math.floor((progress.transferred / progress.total) * 100)));
  const phase = progress === null ? "Preparing" : uploadPhaseLabels[progress.phase];
  const subtitle = failed
    ? "Upload failed"
    : busy
      ? `${phase}${percent === null ? "…" : ` · ${String(percent)}%`}`
      : `${state?.status === "ready" ? "Ready" : props.label}${props.bytes === undefined ? "" : ` · ${formatAttachmentBytes(props.bytes)}`}`;
  return (
    <View style={[styles.card, props.compact === true && styles.compact]} testID={props.testID}>
      <Pressable
        accessibilityHint={subtitle}
        accessibilityLabel={`Open ${props.name}`}
        accessibilityRole="button"
        disabled={props.onOpen === undefined}
        onPress={props.onOpen}
        style={styles.open}
      >
        <View style={styles.thumbnail}>
          {props.uri !== null && props.uri !== undefined && props.uri !== "" ? (
            <Image
              accessibilityLabel={props.name}
              onError={props.onThumbnailError}
              resizeMode="cover"
              source={{ uri: props.uri }}
              style={styles.image}
            />
          ) : (
            <Ionicons
              color={colors.accent}
              name={
                props.icon ??
                (props.video === true ? "play-circle-outline" : "document-text-outline")
              }
              size={iconSize.action}
            />
          )}
          {busy && (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          )}
        </View>
        <View style={styles.details}>
          <Text numberOfLines={1} style={styles.name}>
            {props.name}
          </Text>
          {props.excerpt !== undefined && props.excerpt !== "" && (
            <Text numberOfLines={2} style={styles.excerpt}>
              {props.excerpt}
            </Text>
          )}
          <Text numberOfLines={2} style={[styles.subtitle, failed && styles.error]}>
            {subtitle}
          </Text>
          {failed && (
            <Text numberOfLines={2} style={styles.subtitle}>
              {state.message}
            </Text>
          )}
          {busy && percent !== null && (
            <View
              accessibilityLabel={`${phase} ${props.name}`}
              accessibilityRole="progressbar"
              accessibilityValue={{ max: 100, min: 0, now: percent }}
              accessible
              style={styles.progressTrack}
            >
              <View style={[styles.progressFill, { width: percentageDimension(percent) }]} />
            </View>
          )}
        </View>
      </Pressable>
      {failed && props.onRetry !== undefined && (
        <Pressable
          accessibilityLabel={`Retry ${props.name}`}
          accessibilityRole="button"
          onPress={props.onRetry}
          style={styles.action}
        >
          <Ionicons color={colors.red} name="refresh" size={iconSize.inline} />
        </Pressable>
      )}
      {props.onRemove !== undefined && (
        <Pressable
          accessibilityLabel={`Remove ${props.name}`}
          accessibilityRole="button"
          onPress={props.onRemove}
          style={styles.action}
        >
          <Ionicons color={colors.textMuted} name="close" size={iconSize.inline} />
        </Pressable>
      )}
    </View>
  );
}

const uploadPhaseLabels = {
  hashing: "Preparing",
  transferring: "Uploading",
  verifying: "Verifying",
} as const;

function formatAttachmentBytes(bytes: number): string {
  return bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${String(Math.ceil(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: touchTarget,
  },
  busy: {
    alignItems: "center",
    backgroundColor: colors.scrim,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  card: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.xs,
  },
  compact: { width: 260 },
  details: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  error: { color: colors.red },
  excerpt: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  image: {
    height: "100%",
    width: "100%",
  },
  name: {
    ...typeScale.label,
    color: colors.text,
  },
  open: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: "100%",
  },
  progressTrack: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.pill,
    height: 3,
    marginTop: spacing.optical,
    overflow: "hidden",
  },
  subtitle: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  thumbnail: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.compact,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    width: 56,
  },
});
