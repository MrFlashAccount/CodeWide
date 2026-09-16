import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { ActivityIndicator, View } from "react-native";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import type { ThreadResourcesValue } from "../../data/workspace-resource-database";
import type { ThreadAttachmentResource } from "../../data/thread-resource-types";
import { useThreadResources } from "../../data/use-thread-resources";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import { colors, iconSize } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AttachmentsFeature.styles";
import { ThreadAttachmentResourceRow } from "./ThreadAttachmentResourceRow";
import { useAttachmentRouteActions } from "./threadAttachmentRouteActions";
import { attachmentRouteState } from "./threadAttachmentRouteState";

const ATTACHMENTS_SHEET_PROPS: React.ComponentProps<typeof AppSheet>["contentProps"] = {
  contentContainerClassName: "h-full",
  dismissLabel: "Close attachments",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

/** Route-owned attachment list; media stays local while documents become child routes. */
export function ThreadAttachmentsRoute({
  cwd,
  getTransferAccess,
  model,
  onClose,
  onOpenDocument,
  onReload,
  resourceId,
  revision,
}: {
  readonly cwd: string;
  readonly getTransferAccess: GetTransferAccess;
  readonly model: ThreadResourcesModel | null;
  readonly onClose: () => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
  readonly onReload?: () => Promise<ThreadResourcesValue>;
  readonly resourceId: string | null;
  readonly revision: string;
}): React.JSX.Element {
  const resource = useThreadResources(model, resourceId, onReload, { revision });
  const { attachments, error, pending, ready } = attachmentRouteState(resource);
  const openAttachment = useAttachmentRouteActions({ cwd, getTransferAccess, onOpenDocument });
  return (
    <AppSheet
      contentProps={ATTACHMENTS_SHEET_PROPS}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <AttachmentRouteHeader count={attachments.length} loading={pending && !ready} />
      <AttachmentRouteList
        attachments={attachments}
        error={error}
        onOpenAttachment={openAttachment}
        ready={ready}
      />
    </AppSheet>
  );
}

function AttachmentRouteHeader({
  count,
  loading,
}: {
  readonly count: number;
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.menuTitleRow}>
      <View style={styles.sheetHeaderIconSlot}>
        <Ionicons color={colors.textMuted} name="attach-outline" size={iconSize.action} />
      </View>
      <Text numberOfLines={1} style={styles.sheetTitle}>
        {`Attachments · ${String(count)}`}
      </Text>
      <View style={styles.flex} />
      {loading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
    </View>
  );
}

function AttachmentRouteList({
  attachments,
  error,
  onOpenAttachment,
  ready,
}: {
  readonly attachments: readonly ThreadAttachmentResource[];
  readonly error: string | null;
  readonly onOpenAttachment: (attachment: ThreadAttachmentResource) => void;
  readonly ready: boolean;
}): React.JSX.Element {
  if (attachments.length === 0 && ready) {
    return <Text style={styles.menuNotice}>No attachments in this thread.</Text>;
  }
  return (
    <>
      {error === null ? null : <Text style={styles.errorText}>{error}</Text>}
      <LegendList
        contentContainerStyle={styles.threadResourcesContent}
        data={attachments}
        getFixedItemSize={() => listRowHeight.double}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(attachment) => attachment.key}
        renderItem={({ index, item }) => (
          <AttachmentRouteRow
            attachment={item}
            count={attachments.length}
            index={index}
            onOpenAttachment={onOpenAttachment}
          />
        )}
        renderScrollComponent={AppSheetScrollView}
        style={styles.menuScroll}
      />
    </>
  );
}

function AttachmentRouteRow({
  attachment,
  count,
  index,
  onOpenAttachment,
}: {
  readonly attachment: ThreadAttachmentResource;
  readonly count: number;
  readonly index: number;
  readonly onOpenAttachment: (attachment: ThreadAttachmentResource) => void;
}): React.JSX.Element {
  return (
    <View style={styles.threadAttachmentCell}>
      <ThreadAttachmentResourceRow
        attachment={attachment}
        onPress={() => {
          onOpenAttachment(attachment);
        }}
        position={listRowPosition(index, count)}
      />
    </View>
  );
}
