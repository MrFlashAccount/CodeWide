import { Linking } from "react-native";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadAttachmentResource } from "../../data/thread-resource-types";
import { isAttachmentVideo } from "../../rendering/AttachmentVideoPreview";
import { remoteFileKind, resolveRemoteDocumentPath } from "../../rendering/document-preview";
import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { isSafeHttpUrl } from "../../rendering/http-link";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";

type AttachmentRouteActionsInput = {
  readonly cwd: string;
  readonly getTransferAccess: GetTransferAccess;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
};

/** Resolves attachment sources and dispatches them to the matching presentation owner. */
export function useAttachmentRouteActions({
  cwd,
  getTransferAccess,
  onOpenDocument,
}: AttachmentRouteActionsInput): (attachment: ThreadAttachmentResource) => void {
  const dialog = useAppDialog();
  const download = useDocumentDownload();
  const openRequest = useEvent((request: DocumentPreviewRequest): void => {
    if (request.kind === "download" && !isAttachmentVideo(request.name)) {
      void download(request).catch(() => {
        dialog.alert("Download failed", "The attachment could not be downloaded.");
      });
    } else {
      onOpenDocument(request);
    }
  });
  return useEvent((attachment: ThreadAttachmentResource): void => {
    if (attachment.path !== null) {
      const path = resolveRemoteDocumentPath(attachment.path, cwd);
      if (path === null) {
        dialog.alert("File unavailable", "The companion returned an invalid file path.");
        return;
      }
      openRequest({
        getTransferAccess,
        kind: remoteFileKind(attachment.name, path),
        name: attachment.name,
        path,
      });
      return;
    }
    if (attachment.url === null || !isSafeHttpUrl(attachment.url)) {
      dialog.alert("Attachment unavailable", "This attachment has no openable source.");
      return;
    }
    const kind = remoteFileKind(attachment.name, attachment.url);
    if (kind === "download" && !isAttachmentVideo(attachment.name)) {
      void Linking.openURL(attachment.url).catch(() => {
        dialog.alert("Attachment unavailable", "The attachment URL could not be opened.");
      });
      return;
    }
    openRequest({
      getTransferAccess,
      kind,
      name: attachment.name,
      path: attachment.name,
      source: { kind: "remote", url: attachment.url },
    });
  });
}
