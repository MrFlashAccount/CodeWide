import { useEvent } from "../../react/useEvent";
/** V1 documentNavigation owner, extracted without changing interaction or resource lifetime. */
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";

export type ThreadResourceDocumentRoute = {
  request: DocumentPreviewRequest;
  revision: number;
};

import type { GetTransferAccess } from "../../data/private-transfer";
import {
  isAttachmentVideo,
  useAttachmentVideoPreview,
} from "../../rendering/AttachmentVideoPreview";
import { resolvePreviewableDocumentLink } from "../../rendering/document-preview";
import { useDocumentPreview } from "../../rendering/DocumentPreviewHost";
import { parseLoopbackLink, type LoopbackLinkTarget } from "../../rendering/loopback-link";
import { useAppDialog } from "../../ui/AppDialog";

export function useDocumentNavigation(
  cwd: string,
  getTransferAccess: GetTransferAccess | undefined,
  getStableTransferAccess: GetTransferAccess,
  onOpenLoopbackLink: ((target: LoopbackLinkTarget) => Promise<void>) | undefined,
  openCodeDocument: (request: DocumentPreviewRequest) => void,
) {
  const dialog = useAppDialog();
  const openDocument = useDocumentPreview();
  const openVideo = useAttachmentVideoPreview();

  const openDocumentLinkFromCwd = useEvent((href: string, sourceCwd: string) => {
    const loopback = parseLoopbackLink(href);
    if (loopback !== null && onOpenLoopbackLink !== undefined) {
      void onOpenLoopbackLink(loopback).catch((cause: unknown) => {
        dialog.alert(
          "Could not open localhost",
          cause instanceof Error ? cause.message : "The forwarded URL could not be opened.",
        );
      });
      return true;
    }
    if (getTransferAccess === undefined) return false;
    const target = resolvePreviewableDocumentLink(href, sourceCwd);
    if (target === null) return false;
    const request = { ...target, getTransferAccess: getStableTransferAccess };
    if (isAttachmentVideo(target.name))
      openVideo({
        name: target.name,
        source: { kind: "path", path: target.path },
        getAccess: getStableTransferAccess,
      });
    else if (target.kind === "text") openCodeDocument(request);
    else openDocument(request);
    return true;
  });

  const openThreadDocumentLink = useEvent((href: string) => openDocumentLinkFromCwd(href, cwd));
  return { openDocumentLinkFromCwd, openThreadDocumentLink };
}

export function useDocumentTransferAccess(getTransferAccess: GetTransferAccess | undefined) {
  const getStableTransferAccess = useEvent(async (forceRefresh = false) => {
    if (getTransferAccess === undefined) throw new Error("File access is unavailable");
    return await getTransferAccess(forceRefresh);
  });
  return getStableTransferAccess;
}
