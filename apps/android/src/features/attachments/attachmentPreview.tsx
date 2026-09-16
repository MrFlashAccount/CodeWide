import { useEvent } from "../../react/useEvent";
import { useAttachmentDocumentResource } from "./attachmentDocumentResource";
/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import { useId, useRef, useState } from "react";
import { Linking } from "react-native";
import { useThreadResources } from "../../data/use-thread-resources";
import type { ThreadAttachmentResource } from "../../data/workspace-resource-database";
import {
  isAttachmentVideo,
  useAttachmentVideoPreview,
} from "../../rendering/AttachmentVideoPreview";
import {
  remoteDocumentDirectory,
  remoteFileKind,
  resolvePreviewableDocumentLink,
  resolveRemoteDocumentPath,
} from "../../rendering/document-preview";
import {
  useDocumentDownload,
  useDocumentPreview,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { isSafeHttpUrl } from "../../rendering/http-link";
import { useAppDialog } from "../../ui/AppDialog";
import { useAppFullscreenOverlay } from "../../ui/AppFullscreenOverlay";
import { codeReviewFilesForDocument } from "../review/resources/reviewFiles";
import { CodeReviewWorkspace } from "../review/workspace/CodeReviewWorkspace";
import type { ThreadResourceDocumentRoute } from "./documentNavigation";

import type { AttachmentSheetProps } from "./attachmentSheetContract";

export function useAttachmentPreview({
  cwd,
  getTransferAccess,
  model,
  onAttachReview,
  onClose,
  onLoadThreadChangeDiff,
  onReload,
  resourceId,
  revision,
  thread,
  voiceRuntime,
}: AttachmentSheetProps) {
  const resource = useThreadResources(model, resourceId, onReload, { revision });
  const dialog = useAppDialog();
  const openDocument = useDocumentPreview();
  const openVideo = useAttachmentVideoPreview();
  const downloadDocument = useDocumentDownload();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const previewResourceOwnerId = useId();
  const previewRevisionRef = useRef(0);
  const [documentStack, setDocumentStack] = useState<ThreadResourceDocumentRoute[]>([]);
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const changes = resource?.value?.changes ?? [];
  const attachments = resource?.value?.attachments ?? [];
  const attachmentsPending =
    resource === null ||
    (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes("attachments"));
  const attachmentsReady =
    resource?.readyKinds === undefined
      ? resource?.value !== null && resource?.value !== undefined
      : resource.readyKinds.includes("attachments");
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const attachmentsError =
    resource?.resourceErrors?.attachments ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const title = `Attachments · ${String(attachments.length)}`;
  const document = documentStack.at(-1) ?? null;
  const { documentResult } = useAttachmentDocumentResource({ document, previewResourceOwnerId });
  const loadPreview = useEvent((request: DocumentPreviewRequest, replace: boolean) => {
    previewRevisionRef.current += 1;
    const revision = previewRevisionRef.current;
    const route: ThreadResourceDocumentRoute = { request, revision };
    setDocumentStack((current) =>
      replace ? [...current.slice(0, -1), route] : [...current, route],
    );
  });
  const openPreview = useEvent((request: DocumentPreviewRequest) => {
    if (isAttachmentVideo(request.name)) {
      openVideo({
        getAccess: request.getTransferAccess,
        name: request.name,
        source: request.source ?? { kind: "path", path: request.path },
      });
      return;
    }
    if (request.kind === "download") {
      downloadDocument(request).catch((error: unknown) => {
        dialog.error("Download failed", error);
      });
      return;
    }
    if (request.kind === "image") {
      openDocument(request);
      return;
    }
    if (request.kind === "text") {
      fullscreenOverlay.present(({ close }) => (
        <CodeReviewWorkspace
          changes={codeReviewFilesForDocument(changes, request.path)}
          key={`${request.path}:${String(request.line ?? "")}:${String(request.column ?? "")}`}
          {...(request.source === undefined
            ? {}
            : { sourceAssets: { [request.path]: request.source } })}
          changeScope={resource?.value?.changeScope ?? "session"}
          changeScopes={resource?.value?.changeScopes ?? ["session", "lastTurn"]}
          initialPath={request.path}
          {...(request.line === undefined ? {} : { initialLine: request.line })}
          {...(request.column === undefined ? {} : { initialColumn: request.column })}
          cwd={cwd}
          getTransferAccess={getTransferAccess}
          onAttach={onAttachReview}
          onClose={close}
          onDownload={() => void downloadDocument(request)}
          thread={thread}
          voiceRuntime={voiceRuntime}
          {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
        />
      ));
      return;
    }
    loadPreview(request, false);
  });
  const closeSheet = useEvent(() => {
    previewRevisionRef.current += 1;
    setDocumentStack([]);
    onClose();
  });
  const navigateBack = useEvent(() => {
    previewRevisionRef.current += 1;
    setDocumentStack((current) => current.slice(0, -1));
  });
  const openPath = useEvent((name: string, sourcePath: string) => {
    const resolvedPath = resolveRemoteDocumentPath(sourcePath, cwd);
    if (resolvedPath === null) {
      dialog.alert("File unavailable", "The companion returned an invalid file path.");
      return;
    }
    openPreview({
      getTransferAccess,
      kind: remoteFileKind(name, resolvedPath),
      name,
      path: resolvedPath,
    });
  });
  const openAttachment = useEvent((attachment: ThreadAttachmentResource) => {
    if (attachment.path !== null) {
      openPath(attachment.name, attachment.path);
      return;
    }
    if (attachment.url !== null && isSafeHttpUrl(attachment.url)) {
      const kind = remoteFileKind(attachment.name, attachment.url);
      if (kind === "download" && !isAttachmentVideo(attachment.name)) {
        Linking.openURL(attachment.url).catch((error: unknown) => {
          dialog.alert(
            "Could not open attachment",
            error instanceof Error ? error.message : "Could not open attachment",
          );
        });
        return;
      }
      openPreview({
        getTransferAccess,
        kind,
        name: attachment.name,
        path: attachment.name,
        source: { kind: "remote", url: attachment.url },
      });
    } else {
      dialog.alert("Attachment unavailable", "This attachment has no openable source.");
    }
  });
  const openNestedDocument = useEvent((href: string) => {
    if (document === null) {
      return false;
    }
    const target = resolvePreviewableDocumentLink(
      href,
      remoteDocumentDirectory(document.request.path),
    );
    if (target === null) {
      return false;
    }
    const request = {
      ...target,
      getTransferAccess,
    };
    if (target.kind === "text") {
      openPreview(request);
    } else {
      openPreview(request);
    }
    return true;
  });
  const retryPreview = useEvent(() => {
    if (document !== null) {
      loadPreview(document.request, true);
    }
  });

  return {
    attachments,
    attachmentsError,
    attachmentsInitialLoading,
    attachmentsReady,
    closeSheet,
    document,
    documentResult,
    documentViewportWidth,
    downloadDocument,
    navigateBack,
    openAttachment,
    openNestedDocument,
    retryPreview,
    setDocumentViewportWidth,
    title,
  };
}
