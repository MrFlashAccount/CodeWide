import { useId, useState } from "react";

import {
  remoteDocumentDirectory,
  resolvePreviewableDocumentLink,
} from "../../rendering/document-preview";
import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { useEvent } from "../../react/useEvent";
import { AppSheet } from "../../ui/AppSheet";
import { AttachmentDocumentPreview } from "./AttachmentDocumentPreview";
import { useAttachmentDocumentResource } from "./attachmentDocumentResource";

const DOCUMENT_SHEET_PROPS: React.ComponentProps<typeof AppSheet>["contentProps"] = {
  contentContainerClassName: "h-full",
  dismissLabel: "Back to previous document",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

/** Renders one text document and delegates nested links to child routes. */
export function RouteTextDocumentPreview({
  onClose,
  onOpenDocument,
  request,
}: {
  readonly onClose: () => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
  readonly request: DocumentPreviewRequest;
}): React.JSX.Element {
  const ownerId = useId();
  const [revision, setRevision] = useState(0);
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const document = { request, revision };
  const { documentResult } = useAttachmentDocumentResource({
    document,
    previewResourceOwnerId: ownerId,
  });
  const downloadDocument = useDocumentDownload();
  const retryPreview = useEvent(() => {
    setRevision((current) => current + 1);
  });
  const openNestedDocument = useEvent((href: string): boolean => {
    const target = resolvePreviewableDocumentLink(href, remoteDocumentDirectory(request.path));
    if (target === null) {
      return false;
    }
    onOpenDocument({ ...target, getTransferAccess: request.getTransferAccess });
    return true;
  });
  const preview = {
    document,
    documentResult,
    documentViewportWidth,
    downloadDocument,
    navigateBack: onClose,
    openNestedDocument,
    retryPreview,
    setDocumentViewportWidth,
  };
  return (
    <AppSheet
      contentProps={DOCUMENT_SHEET_PROPS}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <AttachmentDocumentPreview codePreviewMaxHeight={420} preview={preview} />
    </AppSheet>
  );
}
