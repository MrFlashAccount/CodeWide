/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ContentReviewComments, ContentReviewComposer } from "../../rendering/ContentReviewHost";
import {
  HtmlDocumentPreview,
  MAX_DOCUMENT_PREVIEW_BYTES,
} from "../../rendering/DocumentPreviewHost";
import { MarkdownLocalLinkProvider } from "../../rendering/MarkdownLinkHandler";
import { nativeCodeLanguageForPath } from "../../rendering/native-code-block";
import { NativeCodeBlock } from "../../rendering/NativeCodeBlock";
import { RichContentWidthProvider } from "../../rendering/RichContentLayout";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { colors, iconSize, spacing } from "../../theme";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AttachmentsFeature.styles";

import type { useAttachmentPreview } from "./attachmentPreview";

export function AttachmentDocumentPreview({
  preview,
  codePreviewMaxHeight,
}: {
  preview: ReturnType<typeof useAttachmentPreview>;
  codePreviewMaxHeight: number;
}) {
  const {
    document,
    documentResult,
    documentViewportWidth,
    setDocumentViewportWidth,
    downloadDocument,
    navigateBack,
    retryPreview,
    openNestedDocument,
  } = preview;
  return (
    <>
      {document !== null && (
        <View style={styles.threadResourceRoute}>
          <View style={styles.menuTitleRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to attachments"
              onPress={navigateBack}
              style={styles.headerIcon}
            >
              <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
            </Pressable>
            <View style={styles.sheetHeaderIconSlot}>
              <Ionicons
                name={document.request.kind === "html" ? "globe-outline" : "document-text-outline"}
                size={iconSize.action}
                color={colors.textMuted}
              />
            </View>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.sheetTitle}>
              {document.request.name}
            </Text>
            <View style={styles.flex} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Download ${document.request.name}`}
              onPress={() => void downloadDocument(document.request)}
              style={styles.headerIcon}
            >
              <Ionicons name="download-outline" size={iconSize.action} color={colors.text} />
            </Pressable>
          </View>
          {documentResult.phase === "loading" && (
            <View style={styles.threadResourcePreviewCenter}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.menuNotice}>Loading document…</Text>
            </View>
          )}
          {documentResult.phase === "error" && (
            <View style={styles.threadResourcePreviewCenter}>
              <Text selectable style={styles.errorText}>
                {documentResult.message}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={retryPreview}
                style={styles.primaryAction}
              >
                <Ionicons name="refresh" size={iconSize.action} color={colors.onPrimary} />
                <Text style={styles.primaryActionText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {documentResult.phase === "ready" && document.request.kind === "html" && (
            <HtmlDocumentPreview
              testID="thread-resource-html-preview"
              source={documentResult.source}
            />
          )}
          {documentResult.phase === "ready" && document.request.kind !== "html" && (
            <AppSheetScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.threadResourceDocumentContent}
              keyboardShouldPersistTaps="handled"
              onLayout={({ nativeEvent }) => {
                const nextWidth = Math.max(
                  0,
                  Math.floor(nativeEvent.layout.width - spacing.md * 2),
                );
                setDocumentViewportWidth((current) =>
                  current === nextWidth ? current : nextWidth,
                );
              }}
            >
              {document.request.kind === "text" ? (
                <NativeCodeBlock
                  value={documentResult.source}
                  language={nativeCodeLanguageForPath(document.request.path)}
                  maxHeight={codePreviewMaxHeight}
                  fillAvailableWidth
                />
              ) : (
                <RichContentWidthProvider
                  width={documentViewportWidth > 0 ? documentViewportWidth : null}
                >
                  <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
                    {documentResult.segments.map((segment, index) => (
                      <RichMarkdown
                        key={index}
                        source={segment}
                        reviewTarget={{
                          id: `markdown-document:${document.request.path}`,
                          label: document.request.name,
                          reference: document.request.path,
                        }}
                        reviewPathPrefix={`segment-${index}`}
                      />
                    ))}
                  </MarkdownLocalLinkProvider>
                </RichContentWidthProvider>
              )}
              {documentResult.truncated && (
                <Text style={styles.menuNotice}>
                  Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download
                  the file to read the rest.
                </Text>
              )}
              {document.request.kind === "markdown" && (
                <ContentReviewComments targetId={`markdown-document:${document.request.path}`} />
              )}
            </AppSheetScrollView>
          )}
          {documentResult.phase === "ready" && document.request.kind === "markdown" && (
            <ContentReviewComposer
              targetId={`markdown-document:${document.request.path}`}
              anchorKind="text"
            />
          )}
        </View>
      )}
    </>
  );
}
