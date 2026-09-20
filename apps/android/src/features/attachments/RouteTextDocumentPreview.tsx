import {
  DocumentPagePreview,
  useDocumentDownload,
  type DocumentPagePreviewRequest,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { useEvent } from "../../react/useEvent";

/** Renders one text document and delegates nested links to child routes. */
export function RouteTextDocumentPreview({
  onClose,
  onOpenDocument,
  request,
}: {
  readonly onClose: () => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
  readonly request: DocumentPagePreviewRequest;
}): React.JSX.Element {
  const downloadDocument = useDocumentDownload();
  const download = useEvent((): void => {
    // The shared download owner presents failures; this event boundary only observes settlement.
    downloadDocument(request).catch(() => undefined);
  });
  return (
    <DocumentPagePreview
      onClose={onClose}
      onDownload={download}
      onOpen={onOpenDocument}
      request={request}
    />
  );
}
