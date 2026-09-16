import { CodeReviewWorkspace } from "../review/CodeReviewWorkspace";
import { useDocumentDownload } from "../../rendering/DocumentPreviewHost";
import type { CodeDocumentRouteRequest } from "../../services/changes/changesRouteSession";

/** Presents one code document through the review surface captured by its route session. */
export function RouteCodeDocumentReview({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: CodeDocumentRouteRequest;
}): React.JSX.Element {
  const document = request.document;
  const download = useDocumentDownload();
  const loadDiff = request.loadDiff;
  return (
    <CodeReviewWorkspace
      changes={request.files}
      key={`${document.path}:${String(document.line ?? "")}:${String(document.column ?? "")}`}
      {...(document.source === undefined
        ? {}
        : { sourceAssets: { [document.path]: document.source } })}
      initialPath={document.path}
      {...(document.line === undefined ? {} : { initialLine: document.line })}
      {...(document.column === undefined ? {} : { initialColumn: document.column })}
      cwd={request.cwd}
      getTransferAccess={request.getTransferAccess}
      onAttach={request.attachCodeReview}
      onClose={onClose}
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onDownload={() => void download(document)}
      thread={request.thread}
      voiceRuntime={request.voiceRuntime}
      {...(loadDiff === undefined
        ? {}
        : { onLoadDiff: async (path: string) => loadDiff(path, request.changeScope) })}
    />
  );
}
