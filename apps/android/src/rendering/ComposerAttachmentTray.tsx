import { useSelector } from "@legendapp/state/react";
import { useContext, useState } from "react";
import { ThreadCodeDocumentContext } from "./ThreadCodeDocumentContext";
import { ScrollView, StyleSheet } from "react-native";

import { composerUploads, type ComposerUpload } from "../data/composer-uploads";
import type { GetTransferAccess } from "../data/private-transfer";
import type { StoredDraftAttachment } from "../data/thread-ui-state-types";
import { spacing } from "../theme";
import { AttachmentCard } from "./AttachmentCard";
import { isAttachmentVideo, useAttachmentVideoPreview } from "./AttachmentVideoPreview";
import {
  composerAttachmentPreviewKind,
  composerAttachmentSource,
} from "./composer-attachment-preview";
import { useDocumentPreview } from "./DocumentPreviewHost";
import { useImagePreview, useRegisterImagePreviewItem } from "./ImagePreviewHost";
import { PrivateImageAccessProvider, usePrivateAssetUri } from "./use-private-image-uri";

interface ComposerAttachmentTrayProps {
  readonly scope: string;
  readonly attachments: readonly StoredDraftAttachment[];
  readonly getAccess: GetTransferAccess;
  onRemove(id: string): void;
}

export function ComposerAttachmentTray(props: ComposerAttachmentTrayProps) {
  const uploads = useSelector(() => composerUploads.entries(props.scope));
  const managed = new Set(uploads.map((entry) => entry.attachment.id));
  if (uploads.length === 0 && props.attachments.length === 0) return null;
  return (
    <PrivateImageAccessProvider scope={props.scope} getAccess={props.getAccess}>
      <ScrollView
        testID="composer-attachment-strip"
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {props.attachments
          .filter((item) => !managed.has(item.id))
          .map((attachment) => (
            <ComposerCard key={attachment.id} attachment={attachment} upload={null} owner={props} />
          ))}
        {uploads.map((upload) => (
          <ComposerCard
            key={upload.attachment.id}
            attachment={upload.attachment}
            upload={upload}
            owner={props}
          />
        ))}
      </ScrollView>
    </PrivateImageAccessProvider>
  );
}

interface ComposerCardProps {
  readonly attachment: StoredDraftAttachment;
  readonly upload: ComposerUpload | null;
  readonly owner: ComposerAttachmentTrayProps;
}

function ComposerCard(props: ComposerCardProps) {
  const { attachment, upload, owner } = props;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const openImage = useImagePreview();
  const openDocument = useDocumentPreview();
  const openCodeDocument = useContext(ThreadCodeDocumentContext);
  const documentKind = composerAttachmentPreviewKind(attachment);
  const openFile =
    documentKind === "text" && openCodeDocument !== null ? openCodeDocument : openDocument;
  const openVideo = useAttachmentVideoPreview();
  const video = isAttachmentVideo(attachment.name);
  const baseSource = composerAttachmentSource(attachment);
  const source =
    attachment.editor === undefined
      ? baseSource
      : { ...baseSource, cacheRevision: String(attachment.editor.revision) };
  const preview = upload?.preview ?? attachment.preview;
  const localUri = preview?.uri === failedUri ? null : (preview?.uri ?? null);
  const ready = upload === null || upload.state.status === "ready";
  const image = usePrivateAssetUri(
    attachment.kind === "image" && localUri === null && ready ? source : null,
    attachment.editor?.revision ?? 0,
    owner.getAccess,
  );
  const uri = localUri ?? image.uri;
  const groupId = `composer:${owner.scope}`;
  const item = {
    id: attachment.id,
    label: attachment.name,
    source: { uri: uri ?? "about:blank" },
    reference: `scoped:${attachment.rootId}:${attachment.path}`,
    order: 0,
    draft: { scope: owner.scope, attachmentId: attachment.id },
  };
  useRegisterImagePreviewItem(attachment.kind === "image" && uri !== null ? groupId : null, item);
  const open = () => {
    if (attachment.kind === "image" && uri !== null) openImage({ ...item, groupId });
    else if (video && (localUri !== null || ready))
      openVideo({
        name: attachment.name,
        source: localUri === null ? source : { kind: "direct", uri: localUri },
        getAccess: owner.getAccess,
      });
    else if (ready)
      openFile({
        kind: documentKind,
        name: attachment.name,
        path: attachment.path,
        source,
        getTransferAccess: owner.getAccess,
      });
  };
  return (
    <AttachmentCard
      compact
      video={video}
      name={attachment.name}
      label={
        video
          ? "Video"
          : attachment.editor === undefined
            ? composerAttachmentPreviewKind(attachment)
            : "Drawing"
      }
      uri={attachment.kind === "image" ? uri : null}
      excerpt={preview?.text ?? null}
      {...(preview === undefined ? {} : { bytes: preview.bytes })}
      {...(upload === null ? {} : { state: upload.state })}
      {...(ready || ((video || attachment.kind === "image") && uri !== null)
        ? { onOpen: open }
        : {})}
      onRemove={() => {
        composerUploads.remove(owner.scope, attachment.id);
        owner.onRemove(attachment.id);
      }}
      onRetry={() => composerUploads.retry(owner.scope, attachment.id)}
      onThumbnailError={() => setFailedUri(localUri)}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
});
