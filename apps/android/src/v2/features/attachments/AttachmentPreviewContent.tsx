import type { ComponentType } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import type { V2Attachment } from "@codewide/sync-client/v2";

import type {
  PreviewDocument,
  PreviewStreamSource,
} from "../../application/preview/previewTransport";
import type { DocumentViewerPreferences } from "../../application/ports/documentViewerPreferenceStore";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { colors, spacing, typeScale, typeWeight } from "../../theme";
import { AttachmentDocumentPreview } from "./AttachmentDocumentPreview";
import { ImageGalleryPreview } from "./ImageGalleryPreview";
import type { AttachmentGallery } from "./attachmentGallery";
import { formatBytes } from "./attachmentDisplay";
import { isImageAttachment } from "./attachmentPreviewModel";
import type { VideoPlayerCapabilityProps, WebPreviewCapabilityProps } from "./previewCapabilities";
import { isVideoAttachment } from "./videoPreview";

interface AttachmentPreviewContentProps {
  attachment: V2Attachment;
  document: PreviewDocument | null;
  gallery: AttachmentGallery;
  onClose(): void;
  onRefresh(): void | Promise<void>;
  onSubmitted(): void;
  owner: QualifiedThread;
  Player: ComponentType<VideoPlayerCapabilityProps>;
  readerPreferences?: DocumentViewerPreferences;
  stream: PreviewStreamSource | null;
  WebPreview: ComponentType<WebPreviewCapabilityProps>;
}

export function AttachmentPreviewContent(props: AttachmentPreviewContentProps): React.JSX.Element {
  const {
    attachment,
    document,
    gallery,
    onClose,
    onRefresh,
    onSubmitted,
    owner,
    Player,
    readerPreferences,
    stream,
    WebPreview,
  } = props;
  if (document !== null) {
    return (
      <AttachmentDocumentPreview
        attachment={attachment}
        document={document}
        onSubmitted={onSubmitted}
        owner={owner}
        {...(readerPreferences === undefined ? {} : { readerPreferences })}
        WebPreview={WebPreview}
      />
    );
  }
  if (stream === null) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.error}>Attachment source is unavailable.</Text>
      </View>
    );
  }
  if (isVideoAttachment(attachment.name, attachment.mediaType)) {
    return <Player autoplay onRefreshSource={onRefresh} source={stream} title={attachment.name} />;
  }
  if (isImageAttachment(attachment)) {
    return (
      <ImageGalleryPreview
        {...gallery}
        name={attachment.name}
        onClose={onClose}
        onRetry={onRefresh}
        source={stream}
      />
    );
  }
  return (
    <View style={styles.generic}>
      <Ionicons color={colors.textMuted} name="document-outline" size={48} />
      <Text numberOfLines={2} style={styles.genericName}>
        {attachment.name}
      </Text>
      <Text style={styles.genericMetadata}>
        {attachment.mediaType === "" ? "File" : attachment.mediaType} ·{" "}
        {formatBytes(attachment.sizeBytes)}
      </Text>
      <Text style={styles.genericHint}>Use Save or Open to view this file in another app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.red, ...typeScale.body, textAlign: "center" },
  generic: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  genericHint: { color: colors.textMuted, ...typeScale.body, textAlign: "center" },
  genericMetadata: { color: colors.textMuted, ...typeScale.caption },
  genericName: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
    textAlign: "center",
  },
  unavailable: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing.lg },
});
