import { AttachmentDocumentPreview } from "./AttachmentDocumentPreview";
import { useAttachmentPreview } from "./attachmentPreview";
import type { AttachmentSheetProps } from "./attachmentSheetContract";
/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { ActivityIndicator, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AttachmentsFeature.styles";
import { ThreadAttachmentResourceRow } from "./ThreadAttachmentResourceRow";

export function ThreadResourcesSheet(props: AttachmentSheetProps) {
  const { visible, codePreviewMaxHeight } = props;
  const preview = useAttachmentPreview(props);
  const {
    attachments,
    attachmentsInitialLoading,
    attachmentsError,
    attachmentsReady,
    title,
    document,
    navigateBack,
    closeSheet,
    openAttachment,
  } = preview;
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) (document === null ? closeSheet : navigateBack)();
      }}
      contentProps={{
        dismissLabel: document === null ? "Close attachments" : "Back to attachments",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <View
        pointerEvents={document === null ? "auto" : "none"}
        style={[styles.threadResourceRoute, document !== null && styles.threadResourceRouteHidden]}
      >
        <View style={styles.menuTitleRow}>
          <View style={styles.sheetHeaderIconSlot}>
            <Ionicons name="attach-outline" size={iconSize.action} color={colors.textMuted} />
          </View>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>
            {title}
          </Text>
          <View style={styles.flex} />
          {attachmentsInitialLoading && <ActivityIndicator size="small" color={colors.accent} />}
        </View>
        <LegendList
          style={styles.menuScroll}
          contentContainerStyle={styles.threadResourcesContent}
          renderScrollComponent={AppSheetScrollView}
          keyboardShouldPersistTaps="handled"
          data={attachments}
          keyExtractor={(attachment) => attachment.key}
          getFixedItemSize={() => listRowHeight.double}
          renderItem={({ item, index }) => (
            <View style={styles.threadAttachmentCell}>
              <ThreadAttachmentResourceRow
                attachment={item}
                position={listRowPosition(index, attachments.length)}
                onPress={() => openAttachment(item)}
              />
            </View>
          )}
          ListHeaderComponent={
            attachmentsError !== null ? (
              <Text selectable style={styles.errorText}>
                {attachmentsError}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            attachmentsReady ? (
              <View style={styles.threadResourcesEmpty}>
                <Ionicons
                  name="attach-outline"
                  size={iconSize.illustration}
                  color={colors.textDim}
                />
                <Text style={styles.menuNotice}>No attachments in this thread.</Text>
              </View>
            ) : null
          }
        />
      </View>

      <AttachmentDocumentPreview preview={preview} codePreviewMaxHeight={codePreviewMaxHeight} />
    </AppSheet>
  );
}
