import {
  isAttachmentVideo,
  RouteAttachmentVideoPreview,
} from "../../rendering/AttachmentVideoPreview";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import { RouteDownloadDocument } from "./RouteDownloadDocument";
import { RouteImageDocumentPreview } from "./RouteImageDocumentPreview";
import { RouteTextDocumentPreview } from "./RouteTextDocumentPreview";

/** Dispatches one route-qualified private file to its matching route presentation. */
export function RouteDocumentPreview({
  onClose,
  onOpenDocument,
  request,
}: {
  readonly onClose: () => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
  readonly request: DocumentPreviewRequest;
}): React.JSX.Element {
  if (isAttachmentVideo(request.name)) {
    if (request.source === undefined) {
      return (
        <RouteAttachmentVideoPreview
          getAccess={request.getTransferAccess}
          name={request.name}
          onClose={onClose}
          path={request.path}
        />
      );
    }
    return (
      <RouteAttachmentVideoPreview
        getAccess={request.getTransferAccess}
        name={request.name}
        onClose={onClose}
        path={request.path}
        source={request.source}
      />
    );
  }
  if (request.kind === "image") {
    return <RouteImageDocumentPreview onClose={onClose} request={request} />;
  }
  if (request.kind === "download") {
    return <RouteDownloadDocument onClose={onClose} request={request} />;
  }
  return (
    <RouteTextDocumentPreview onClose={onClose} onOpenDocument={onOpenDocument} request={request} />
  );
}
