import { useSelector } from "@legendapp/state/react";
import { useContext, useState, type ReactNode } from "react";
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
import {
  createPrivateImageDetailRequest,
  PrivateImageAccessProvider,
  usePrivateAssetUri,
} from "./use-private-image-uri";

interface ComposerAttachmentTrayProps {
  readonly attachments: readonly StoredDraftAttachment[];
  readonly getAccess: GetTransferAccess;
  onRemove: (id: string) => void;
  readonly scope: string;
  readonly startAttachment?: ReactNode;
}

export function ComposerAttachmentTray(props: ComposerAttachmentTrayProps) {
  const uploads = useSelector(() => composerUploads.entries(props.scope));
  const managed = new Set(uploads.map((entry) => entry.attachment.id));
  if (
    uploads.length === 0 &&
    props.attachments.length === 0 &&
    props.startAttachment === undefined
  ) {
    return null;
  }
  return (
    <PrivateImageAccessProvider getAccess={props.getAccess} scope={props.scope}>
      <ScrollView
        contentContainerStyle={styles.content}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        testID="composer-attachment-strip"
      >
        {props.startAttachment}
        {props.attachments
          .filter((item) => !managed.has(item.id))
          .map((attachment) => (
            <ComposerCard attachment={attachment} key={attachment.id} owner={props} upload={null} />
          ))}
        {uploads.map((upload) => (
          <ComposerCard
            attachment={upload.attachment}
            key={upload.attachment.id}
            owner={props}
            upload={upload}
          />
        ))}
      </ScrollView>
    </PrivateImageAccessProvider>
  );
}

interface ComposerCardProps {
  readonly attachment: StoredDraftAttachment;
  readonly owner: ComposerAttachmentTrayProps;
  readonly upload: ComposerUpload | null;
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
  if (!ready) {
    return;
  }
  if (canRouteDocument && openRouteDocument !== null) {
    openRouteDocument(documentRequest);
  } else {
    openDocument(documentRequest);
  }
}

function ComposerCard(props: ComposerCardProps) {
  const { attachment, owner, upload } = props;
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
    { access: owner.getAccess, revision: attachment.editor?.revision },
  );
  const uri = localUri ?? image.uri;
  const detail =
    attachment.kind === "image" && ready
      ? createPrivateImageDetailRequest(source, {
          accessScope: owner.scope,
          getAccess: owner.getAccess,
          revision: attachment.editor?.revision ?? 0,
        })
      : null;
  const groupId = `composer:${owner.scope}`;
  const item = {
    detail,
    draft: { attachmentId: attachment.id, scope: owner.scope },
    id: attachment.id,
    label: attachment.name,
    order: 0,
    reference: `scoped:${attachment.rootId}:${attachment.path}`,
    source: { uri: uri ?? "about:blank" },
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
      excerpt={preview?.text ?? null}
      label={
        video
          ? "Video"
          : attachment.editor === undefined
            ? composerAttachmentPreviewKind(attachment)
            : "Drawing"
      }
      name={attachment.name}
      uri={attachment.kind === "image" ? uri : null}
      video={video}
      {...(preview === undefined ? {} : { bytes: preview.bytes })}
      {...(upload === null ? {} : { state: upload.state })}
      {...(ready || ((video || attachment.kind === "image") && uri !== null)
        ? { onOpen: open }
        : {})}
      onRemove={() => {
        composerUploads.remove(owner.scope, attachment.id);
        owner.onRemove(attachment.id);
      }}
      onRetry={() => {
        composerUploads.retry(owner.scope, attachment.id);
      }}
      onThumbnailError={() => {
        setFailedUri(localUri);
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
