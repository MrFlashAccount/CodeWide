import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { V2Attachment } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import {
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../../presentation/surfaces/PresentationSheetView";
import { useEvent } from "../../../react/useEvent";
import { attachmentPreviewDestination } from "../navigation/routeDestinations";
import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { formatBytes } from "./attachmentDisplay";

interface AttachmentsScreenProps {
  owner: QualifiedThread;
}

interface AttachmentListProps extends AttachmentsScreenProps {
  attachments: V2Attachment[];
  onClose(): void;
  onRefresh(): Promise<void>;
}

interface AttachmentRowProps extends AttachmentsScreenProps {
  attachment: V2Attachment;
}

export function AttachmentsScreen(props: AttachmentsScreenProps): React.JSX.Element {
  const { owner } = props;
  const close = useEvent(() => router.back());
  const changeOpen = useEvent((open: boolean) => {
    if (!open) close();
  });
  return (
    <PresentationSheetView contentProps={RESOURCE_SHEET_PROPS} isOpen onOpenChange={changeOpen}>
      <V2QueryBoundary
        chrome="none"
        query={{ kind: "thread.resources", scope: "session", threadId: owner.threadId }}
        savedServerId={owner.savedServerId}
        title="Attachments"
      >
        {(result, refresh) => {
          if (result.kind !== "thread.resources") return null;
          return (
            <AttachmentList
              attachments={result.attachments}
              onClose={close}
              onRefresh={refresh}
              owner={owner}
            />
          );
        }}
      </V2QueryBoundary>
    </PresentationSheetView>
  );
}

function AttachmentList(props: AttachmentListProps): React.JSX.Element {
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
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="refresh" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Close attachments"
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
          <View style={styles.empty}>
            <Ionicons color={colors.textDim} name="attach-outline" size={28} />
            <Text style={styles.notice}>No attachments in this thread.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const RESOURCE_SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

function AttachmentRow(props: AttachmentRowProps): React.JSX.Element {
  const { attachment, owner } = props;
  const open = useEvent(() => {
    if (!isLocalUri(attachment.downloadUrl)) return;
    router.push(
      attachmentPreviewDestination({
        attachmentId: attachment.id,
        mediaType: attachment.mediaType,
        name: attachment.name,
        owner,
        sourceUri: attachment.downloadUrl,
      }),
    );
  });
  const enabled = isLocalUri(attachment.downloadUrl);
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

function isLocalUri(value: string | null): value is string {
  return value !== null && (value.startsWith("file:") || value.startsWith("content:"));
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
