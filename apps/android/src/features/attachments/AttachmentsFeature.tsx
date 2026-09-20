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
  const { codePreviewMaxHeight, visible } = props;
  const preview = useAttachmentPreview(props);
  const {
    attachments,
    attachmentsError,
    attachmentsInitialLoading,
    attachmentsReady,
    closeSheet,
    document,
    navigateBack,
    openAttachment,
    title,
  } = preview;
  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: document === null ? "Close attachments" : "Back to attachments",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["55%", "90%"],
      }}
      isOpen={visible}
      {...(document === null ? {} : { onDismissRequest: navigateBack })}
      onOpenChange={(open) => {
        if (!open) {
          closeSheet();
        }
      }}
    >
      <View
        accessibilityElementsHidden={document !== null}
        importantForAccessibility={document === null ? "auto" : "no-hide-descendants"}
        pointerEvents={document === null ? "auto" : "none"}
        style={styles.threadResourceRoute}
      >
        <View style={styles.menuTitleRow}>
          <View style={styles.sheetHeaderIconSlot}>
            <Ionicons color={colors.textMuted} name="attach-outline" size={iconSize.action} />
          </View>
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.sheetTitle}>
            {title}
          </Text>
          <View style={styles.flex} />
          {attachmentsInitialLoading && <ActivityIndicator color={colors.accent} size="small" />}
        </View>
        <LegendList
          contentContainerStyle={styles.threadResourcesContent}
          data={attachments}
          getFixedItemSize={() => listRowHeight.double}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(attachment) => attachment.key}
          ListEmptyComponent={
            attachmentsReady ? (
              <View style={styles.threadResourcesEmpty}>
                <Ionicons
                  color={colors.textDim}
                  name="attach-outline"
                  size={iconSize.illustration}
                />
                <Text style={styles.menuNotice}>No attachments in this thread.</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            attachmentsError !== null ? (
              <Text selectable style={styles.errorText}>
                {attachmentsError}
              </Text>
            ) : null
          }
          renderItem={({ index, item }) => (
            <View style={styles.threadAttachmentCell}>
              <ThreadAttachmentResourceRow
                attachment={item}
                onPress={() => {
                  openAttachment(item);
                }}
                position={listRowPosition(index, attachments.length)}
              />
            </View>
          )}
          renderScrollComponent={AppSheetScrollView}
          style={styles.menuScroll}
        />
      </View>

      <AttachmentDocumentPreview codePreviewMaxHeight={codePreviewMaxHeight} preview={preview} />
    </AppSheet>
  );
}
