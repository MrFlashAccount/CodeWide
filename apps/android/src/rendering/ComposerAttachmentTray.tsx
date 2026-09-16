import { useSelector } from "@legendapp/state/react";
import { useContext, useState } from "react";
import { ThreadCodeDocumentContext } from "./ThreadCodeDocumentContext";
import { ScrollView, StyleSheet } from "react-native";

import { composerUploads, type ComposerUpload } from "../data/composer-uploads";
import type { GetTransferAccess, PrivateAssetSource } from "../data/private-transfer";
import type { StoredDraftAttachment } from "../data/thread-ui-state-types";
import { spacing } from "../theme";
import { AttachmentCard } from "./AttachmentCard";
import { isAttachmentVideo, useAttachmentVideoPreview } from "./AttachmentVideoPreview";
import {
  composerAttachmentPreviewKind,
  composerAttachmentSource,
} from "./composer-attachment-preview";
import { type DocumentPreviewRequest, useDocumentPreview } from "./DocumentPreviewHost";
import {
  type ImagePreviewItem,
  type ImagePreviewRequest,
  useImagePreview,
  useRegisterImagePreviewItem,
} from "./ImagePreviewHost";
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

type ComposerAttachmentOpenOptions = {
  readonly attachment: StoredDraftAttachment;
  readonly canOpenImage: boolean;
  readonly canOpenVideo: boolean;
  readonly canRouteDocument: boolean;
  readonly documentRequest: DocumentPreviewRequest;
  readonly groupId: string;
  readonly item: ImagePreviewItem;
  readonly localUri: string | null;
  readonly openDocument: (request: DocumentPreviewRequest) => void;
  readonly openImage: (request: ImagePreviewRequest) => void;
  readonly openRouteDocument: ((request: DocumentPreviewRequest) => void) | null;
  readonly openVideo: ReturnType<typeof useAttachmentVideoPreview>;
  readonly ready: boolean;
  readonly source: PrivateAssetSource;
};

function openComposerAttachment(options: ComposerAttachmentOpenOptions): void {
  const {
    attachment,
    canOpenImage,
    canOpenVideo,
    canRouteDocument,
    documentRequest,
    groupId,
    item,
    localUri,
    openDocument,
    openImage,
    openRouteDocument,
    openVideo,
    ready,
    source,
  } = options;
  if (canOpenImage) {
    openImage({ ...item, groupId });
    return;
  }
  if (canOpenVideo) {
    const videoSource = localUri === null ? source : { kind: "direct" as const, uri: localUri };
    if (openRouteDocument !== null) {
      openRouteDocument({ ...documentRequest, source: videoSource });
    } else {
      openVideo({
        getAccess: documentRequest.getTransferAccess,
        name: attachment.name,
        source: videoSource,
      });
    }
    return;
  }
  if (!ready) return;
  if (canRouteDocument && openRouteDocument !== null) {
    openRouteDocument(documentRequest);
  } else {
    openDocument(documentRequest);
  }
}

function ComposerCard(props: ComposerCardProps) {
  const { attachment, upload, owner } = props;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const openImage = useImagePreview();
  const openDocument = useDocumentPreview();
  const openRouteDocument = useContext(ThreadCodeDocumentContext);
  const documentKind = composerAttachmentPreviewKind(attachment);
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
  const documentRequest = {
    getTransferAccess: owner.getAccess,
    kind: documentKind,
    name: attachment.name,
    path: attachment.path,
    source,
  };
  const canOpenImage = attachment.kind === "image" && uri !== null;
  const canOpenVideo = video && (localUri !== null || ready);
  const canRouteDocument = openRouteDocument !== null && documentKind !== "download";
  const open = () => {
    openComposerAttachment({
      attachment,
      canOpenImage,
      canOpenVideo,
      canRouteDocument,
      documentRequest,
      groupId,
      item,
      localUri,
      openDocument,
      openImage,
      openRouteDocument,
      openVideo,
      ready,
      source,
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
