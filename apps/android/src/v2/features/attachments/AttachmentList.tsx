import { Ionicons } from "@expo/vector-icons";
import type { V2Attachment } from "@codewide/sync-client/v2";
import { router } from "expo-router";
import { useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { attachmentPreviewDestination } from "../navigation/routeDestinations";
import { formatBytes } from "./attachmentDisplay";

interface AttachmentListProps {
  attachments: V2Attachment[];
  onClose(): void;
  onRefresh(): Promise<void>;
  owner: QualifiedThread;
}

interface AttachmentRowProps {
  attachment: V2Attachment;
  owner: QualifiedThread;
}

export function AttachmentList(props: AttachmentListProps): React.JSX.Element {
  const { attachments, onClose, onRefresh, owner } = props;
  const [refreshing, startRefresh] = useTransition();
  const refresh = useEvent(() => startRefresh(() => onRefresh()));
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerIconSlot}>
          <Ionicons color={colors.textMuted} name="attach-outline" size={21} />
        </View>
        {refreshing ? (
          <ShimmerText style={styles.title} text={`Attachments · ${attachments.length}`} />
        ) : (
          <Text numberOfLines={1} style={styles.title}>
            Attachments · {attachments.length}
          </Text>
        )}
        <View style={styles.flex} />
        <Pressable
          accessibilityLabel="Refresh session resources"
          accessibilityRole="button"
          accessibilityState={{ busy: refreshing, disabled: refreshing }}
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="refresh" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Close attachments"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={21} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {attachments.map((attachment) => (
          <AttachmentRow key={attachment.id} attachment={attachment} owner={owner} />
        ))}
        {attachments.length === 0 ? (
          <View accessibilityLabel="No attachments" accessible style={styles.empty}>
            <Ionicons color={colors.textDim} name="attach-outline" size={28} />
            <Text style={styles.notice}>No attachments in this thread.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function AttachmentRow(props: AttachmentRowProps): React.JSX.Element {
  const { attachment, owner } = props;
  const open = useEvent(() => {
    if (attachment.downloadUrl === null) return;
    router.push(attachmentPreviewDestination({ attachmentId: attachment.id, owner }));
  });
  const enabled = attachment.downloadUrl !== null;
  return (
    <Pressable
      accessibilityLabel={`Open attachment ${attachment.name}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.resourceIcon}>
        <Ionicons color={attachmentColor(attachment)} name={attachmentIcon(attachment)} size={19} />
      </View>
      <View style={styles.resourceText}>
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.resourceTitle}>
          {attachment.name}
        </Text>
        <Text numberOfLines={1} style={styles.resourceSubtitle}>
          {attachment.mediaType === "" ? "file" : attachment.mediaType} ·{" "}
          {formatBytes(attachment.sizeBytes)}
        </Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function attachmentIcon(attachment: V2Attachment): keyof typeof Ionicons.glyphMap {
  if (attachment.mediaType.startsWith("image/")) return "image-outline";
  if (attachment.mediaType.startsWith("video/")) return "videocam-outline";
  if (attachment.mediaType.includes("zip")) return "archive-outline";
  return "document-text-outline";
}

function attachmentColor(attachment: V2Attachment): string {
  if (attachment.mediaType.startsWith("image/")) return colors.green;
  if (attachment.mediaType.startsWith("video/")) return colors.accent;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  content: { gap: spacing.optical, padding: spacing.md, paddingBottom: spacing.xl },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 180 },
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  headerIconSlot: { alignItems: "center", justifyContent: "center", width: 32 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  notice: { color: colors.textMuted, ...typeScale.body },
  resourceIcon: { alignItems: "center", justifyContent: "center", width: 32 },
  resourceSubtitle: { color: colors.textMuted, ...typeScale.caption },
  resourceText: { flex: 1, minWidth: 0 },
  resourceTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  row: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  title: { color: colors.text, ...typeScale.title },
});
