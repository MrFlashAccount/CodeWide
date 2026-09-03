import type { ComponentType } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { V2Attachment } from "@codewide/sync-client/v2";

import type { PreviewDocument } from "../../application/preview/previewTransport";
import type { DocumentViewerPreferences } from "../../application/ports/documentViewerPreferenceStore";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ProductTextScaleProvider } from "../../presentation/text/TextScaleContext";
import { colors, spacing, typeScale } from "../../theme";
import { AttachmentMarkdownReview } from "./AttachmentMarkdownReview";
import {
  decodePreviewDocument,
  isHtmlAttachment,
  isMarkdownAttachment,
} from "./attachmentPreviewModel";
import type { WebPreviewCapabilityProps } from "./previewCapabilities";
import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  documentReadingWidth,
} from "./documentViewerPreferences";

interface AttachmentDocumentPreviewProps {
  attachment: V2Attachment;
  document: PreviewDocument;
  onSubmitted(): void;
  owner: QualifiedThread;
  readerPreferences?: DocumentViewerPreferences;
  WebPreview: ComponentType<WebPreviewCapabilityProps>;
}

export function AttachmentDocumentPreview(
  props: AttachmentDocumentPreviewProps,
): React.JSX.Element {
  const {
    attachment,
    document,
    onSubmitted,
    owner,
    readerPreferences = DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
    WebPreview,
  } = props;
  const decoded = decodePreviewDocument(document);
  if (!decoded.ok) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.errorSurface}>
        <Text style={styles.error}>{decoded.message}</Text>
      </View>
    );
  }
  if (isHtmlAttachment(attachment)) {
    return <WebPreview html={decoded.document.source} title={attachment.name} />;
  }
  if (isMarkdownAttachment(attachment)) {
    return (
      <AttachmentMarkdownReview
        attachment={attachment}
        onSubmitted={onSubmitted}
        owner={owner}
        readerPreferences={readerPreferences}
        source={decoded.document.source}
        truncated={decoded.document.truncated}
      />
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <ProductTextScaleProvider scale={readerPreferences.textScale}>
        <View
          style={[
            styles.document,
            readerPreferences.layoutMode === "reading"
              ? { maxWidth: documentReadingWidth(readerPreferences.textScale) }
              : null,
          ]}
        >
          <Text selectable style={styles.code}>
            {decoded.document.source}
          </Text>
          {decoded.document.truncated ? (
            <View style={styles.truncated}>
              <Text style={styles.truncatedText}>
                Preview is truncated. Save the attachment to read the complete file.
              </Text>
            </View>
          ) : null}
        </View>
      </ProductTextScaleProvider>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  code: { color: colors.text, ...typeScale.code },
  document: { alignSelf: "center", padding: spacing.md, width: "100%" },
  error: { color: colors.red, ...typeScale.body, textAlign: "center" },
  errorSurface: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  scroll: { width: "100%" },
  truncated: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  truncatedText: { color: colors.textMuted, ...typeScale.caption, textAlign: "center" },
});
