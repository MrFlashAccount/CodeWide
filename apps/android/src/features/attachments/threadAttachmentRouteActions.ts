import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadAttachmentResource } from "../../data/thread-resource-types";
import { isAttachmentVideo } from "../../rendering/AttachmentVideoPreview";
import { remoteFileKind, resolveRemoteDocumentLocation } from "../../rendering/document-preview";
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
  readonly onOpenBrowser: (title: string, url: string) => void;
  readonly onOpenCodeDocument: (request: DocumentPreviewRequest) => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
};

type AttachmentPresentationTarget =
  | { readonly kind: "browser"; readonly title: string; readonly url: string }
  | { readonly kind: "codeDocument"; readonly request: DocumentPreviewRequest }
  | { readonly kind: "document"; readonly request: DocumentPreviewRequest }
  | { readonly kind: "download"; readonly request: DocumentPreviewRequest }
  | { readonly kind: "unavailable"; readonly message: string };
type PathAttachmentTargetInput = {
  readonly attachmentKind: ThreadAttachmentResource["kind"];
  readonly cwd: string;
  readonly getTransferAccess: GetTransferAccess;
  readonly name: string;
  readonly sourcePath: string;
};
type UrlAttachmentTargetInput = {
  readonly attachmentKind: ThreadAttachmentResource["kind"];
  readonly getTransferAccess: GetTransferAccess;
  readonly name: string;
  readonly url: string | null;
};

/** Resolves one projected attachment into the presentation that owns its file or URL type. */
export function attachmentPresentationTarget(
  attachment: ThreadAttachmentResource,
  cwd: string,
  getTransferAccess: GetTransferAccess,
): AttachmentPresentationTarget {
  if (attachment.path !== null) {
    return pathAttachmentTarget({
      attachmentKind: attachment.kind,
      cwd,
      getTransferAccess,
      name: attachment.name,
      sourcePath: attachment.path,
    });
  }
  return urlAttachmentTarget({
    attachmentKind: attachment.kind,
    getTransferAccess,
    name: attachment.name,
    url: attachment.url,
  });
}

function pathAttachmentTarget(input: PathAttachmentTargetInput): AttachmentPresentationTarget {
  const location = resolveRemoteDocumentLocation(input.sourcePath, input.cwd);
  if (location === null) {
    return {
      kind: "unavailable",
      message: "The companion returned an invalid file path.",
    };
  }
  const request: DocumentPreviewRequest = {
    getTransferAccess: input.getTransferAccess,
    kind: attachmentDocumentKind(input.attachmentKind, input.name, location.path),
    name: input.name,
    path: location.path,
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.column === undefined ? {} : { column: location.column }),
  };
  if (request.kind === "text") {
    return { kind: "codeDocument", request };
  }
  return request.kind === "download" && !isAttachmentVideo(request.name)
    ? { kind: "download", request }
    : { kind: "document", request };
}

function urlAttachmentTarget(input: UrlAttachmentTargetInput): AttachmentPresentationTarget {
  if (input.url === null || !isSafeHttpUrl(input.url)) {
    return {
      kind: "unavailable",
      message: "This attachment has no openable source.",
    };
  }
  const url = input.url;
  const kind = attachmentDocumentKind(input.attachmentKind, input.name, url);
  if (kind === "download" && !isAttachmentVideo(input.name)) {
    return { kind: "browser", title: input.name, url };
  }
  const request: DocumentPreviewRequest = {
    getTransferAccess: input.getTransferAccess,
    kind,
    name: input.name,
    path: input.name,
    source: { kind: "remote" as const, url },
  };
  return kind === "text" ? { kind: "codeDocument", request } : { kind: "document", request };
}

function attachmentDocumentKind(
  attachmentKind: ThreadAttachmentResource["kind"],
  name: string,
  source: string,
): DocumentPreviewRequest["kind"] {
  return attachmentKind === "image" ? "image" : remoteFileKind(name, source);
}

/** Resolves attachment sources and dispatches them to the matching presentation owner. */
export function useAttachmentRouteActions({
  cwd,
  getTransferAccess,
  onOpenBrowser,
  onOpenCodeDocument,
  onOpenDocument,
}: AttachmentRouteActionsInput): (attachment: ThreadAttachmentResource) => void {
  const dialog = useAppDialog();
  const download = useDocumentDownload();
  return useEvent((attachment: ThreadAttachmentResource): void => {
    const target = attachmentPresentationTarget(attachment, cwd, getTransferAccess);
    if (target.kind === "unavailable") {
      dialog.alert("Attachment unavailable", target.message);
      return;
    }
    if (target.kind === "browser") {
      onOpenBrowser(target.title, target.url);
      return;
    }
    if (target.kind === "download") {
      void download(target.request).catch(() => {
        dialog.alert("Download failed", "The attachment could not be downloaded.");
      });
      return;
    }
    if (target.kind === "codeDocument") {
      onOpenCodeDocument(target.request);
      return;
    }
    onOpenDocument(target.request);
  });
}
