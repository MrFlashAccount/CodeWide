/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import type { Dispatch, SetStateAction } from "react";
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
import { occurrenceKey, textFingerprint } from "../../rendering/listKey";
import { colors, iconSize, spacing } from "../../theme";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { SheetDetailTransition } from "../../ui/sheetNavigation";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AttachmentsFeature.styles";

import type {
  DocumentPreviewRequest,
  DocumentPreviewResult,
} from "../../rendering/DocumentPreviewHost";

export type AttachmentDocumentPreviewModel = {
  readonly document: { readonly request: DocumentPreviewRequest; readonly revision: number } | null;
  readonly documentResult: DocumentPreviewResult;
  readonly documentViewportWidth: number;
  readonly downloadDocument: (request: DocumentPreviewRequest) => Promise<void>;
  readonly navigateBack: () => void;
  readonly openNestedDocument: (href: string) => boolean;
  readonly retryPreview: () => void;
  readonly setDocumentViewportWidth: Dispatch<SetStateAction<number>>;
};

export function AttachmentDocumentPreview({
  codePreviewMaxHeight,
  preview,
}: {
  codePreviewMaxHeight: number;
  preview: AttachmentDocumentPreviewModel;
}) {
  const {
    document,
    documentResult,
    documentViewportWidth,
    downloadDocument,
    navigateBack,
    openNestedDocument,
    retryPreview,
    setDocumentViewportWidth,
  } = preview;
  const segmentOccurrences = new Map<string, number>();
  return (
    <>
      {document !== null && (
        <SheetDetailTransition
          routeKey={`${document.request.path}:${String(document.revision)}`}
          style={styles.threadResourceOverlay}
        >
          <View style={styles.menuTitleRow}>
            <Pressable
              accessibilityLabel="Back to attachments"
              accessibilityRole="button"
              onPress={navigateBack}
              style={styles.headerIcon}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
            </Pressable>
            <View style={styles.sheetHeaderIconSlot}>
              <Ionicons
                color={colors.textMuted}
                name={document.request.kind === "html" ? "globe-outline" : "document-text-outline"}
                size={iconSize.action}
              />
            </View>
            <Text ellipsizeMode="middle" numberOfLines={1} style={styles.sheetTitle}>
              {document.request.name}
            </Text>
            <View style={styles.flex} />
            <Pressable
              accessibilityLabel={`Download ${document.request.name}`}
              accessibilityRole="button"
              onPress={() => void downloadDocument(document.request)}
              style={styles.headerIcon}
            >
              <Ionicons color={colors.text} name="download-outline" size={iconSize.action} />
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
                <Ionicons color={colors.onPrimary} name="refresh" size={iconSize.action} />
                <Text style={styles.primaryActionText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {documentResult.phase === "ready" && document.request.kind === "html" && (
            <HtmlDocumentPreview
              source={documentResult.source}
              testID="thread-resource-html-preview"
            />
          )}
          {documentResult.phase === "ready" && document.request.kind !== "html" && (
            <AppSheetScrollView
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
              style={styles.menuScroll}
            >
              {document.request.kind === "text" ? (
                <NativeCodeBlock
                  fillAvailableWidth
                  language={nativeCodeLanguageForPath(document.request.path)}
                  maxHeight={codePreviewMaxHeight}
                  value={documentResult.source}
                />
              ) : (
                <RichContentWidthProvider
                  width={documentViewportWidth > 0 ? documentViewportWidth : null}
                >
                  <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
                    {documentResult.segments.map((segment, index) => {
                      const key = occurrenceKey(segmentOccurrences, textFingerprint(segment));
                      return (
                        <RichMarkdown
                          key={key}
                          reviewPathPrefix={`segment-${String(index)}`}
                          reviewTarget={{
                            id: `markdown-document:${document.request.path}`,
                            label: document.request.name,
                            reference: document.request.path,
                          }}
                          source={segment}
                        />
                      );
                    })}
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
              anchorKind="text"
              targetId={`markdown-document:${document.request.path}`}
            />
          )}
        </SheetDetailTransition>
      )}
    </>
  );
}
