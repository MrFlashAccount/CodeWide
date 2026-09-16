import type { GetTransferAccess, PrivateAssetSource } from "../../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../../data/thread-resource-types";
import type { ThreadChangeScope } from "../../../data/workspace-resource-database";
import { codeReviewDocumentRevision, type CodeReviewDocument } from "../editor/editorBridge";
import { loadDocumentPreview } from "../../../rendering/DocumentPreviewHost";
import type { CodeReviewFileResource } from "./reviewFiles";

export type CodeReviewResourceValue = {
  diffTruncated: boolean;
  document: CodeReviewDocument;
  warning: string | null;
};

export async function loadCodeReviewResource(
  change: CodeReviewFileResource,
  changeScope: ThreadChangeScope,
  getTransferAccess: GetTransferAccess,
  onLoadDiff:
    | ((path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>)
    | undefined,
  signal: AbortSignal,
  sourceOverrides: Readonly<Record<string, string>> | undefined,
  publish: (value: CodeReviewResourceValue) => void,
  sourceAsset: PrivateAssetSource | undefined,
): Promise<CodeReviewResourceValue> {
  const name = change.path.split("/").at(-1) ?? change.path;
  const sourceOverride = sourceOverrides?.[change.path];
  const sourcePromise =
    sourceOverride !== undefined
      ? Promise.resolve(sourceOverride)
      : change.availability === "available" || change.availability === "unknown"
        ? loadDocumentPreview(
            {
              getTransferAccess,
              kind: "text",
              name,
              path: change.path,
              ...(sourceAsset === undefined ? {} : { source: sourceAsset }),
            },
            signal,
          )
            .then((loaded) => loaded.source)
            .catch((error: unknown) => {
              if (signal.aborted) {
                throw error;
              }
              return `// Current file could not be loaded\n// ${error instanceof Error ? error.message : "File preview failed"}\n`;
            })
        : Promise.resolve(change.availability === "deleted" ? "" : "// File is unavailable\n");
  let diffFailed = false;
  const diffPromise =
    onLoadDiff === undefined || change.sourceOnly === true
      ? Promise.resolve<ThreadChangeDiffValue | null>(null)
      : onLoadDiff(change.path, changeScope).catch(() => {
          diffFailed = true;
          return null;
        });
  const fallbackSource = await sourcePromise;
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const deleted = change.kind === "delete" || change.availability === "deleted";
  const sourceDisplayState: CodeReviewDocument["displayState"] = deleted
    ? "deleted"
    : fallbackSource === ""
      ? "empty"
      : undefined;
  const sourceDocument: CodeReviewDocument = {
    patches: [],
    path: change.path,
    source: fallbackSource,
    ...(sourceDisplayState === undefined ? {} : { displayState: sourceDisplayState }),
    revision: codeReviewDocumentRevision(change.path, fallbackSource, [], sourceDisplayState),
  };
  publish({
    diffTruncated: false,
    document: sourceDocument,
    warning: null,
  });
  const diff = await diffPromise;
  // WHY: The AbortSignal can change while the source and diff Promises are pending.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const source = diff?.source ?? fallbackSource;
  const patches =
    diff?.patches
      .map((patch) => ({ diff: patch.diff, kind: patch.kind }))
      .filter((patch) => patch.diff !== "") ?? [];
  const displayState: CodeReviewDocument["displayState"] = deleted
    ? "deleted"
    : source === "" && patches.length === 0
      ? "empty"
      : undefined;
  const materializedDocument: CodeReviewDocument = {
    patches,
    path: change.path,
    source,
    ...(displayState === undefined ? {} : { displayState }),
    revision: codeReviewDocumentRevision(change.path, source, patches, displayState),
  };
  return {
    diffTruncated: diff?.truncated ?? false,
    document: materializedDocument,
    // WHY: The parallel diff Promise records rejection in this closure before it settles; TypeScript keeps the initial false literal.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    warning: diffFailed
      ? "Diff unavailable. Showing the current file."
      : patches.length === 0 && diff !== null
        ? "Diff contained no renderable patches. Showing the complete current file."
        : null,
  };
}

export function estimateCodeReviewResourceWeight(value: CodeReviewResourceValue): number {
  return (
    (value.document.source.length +
      value.document.patches.reduce((sum, patch) => sum + patch.diff.length, 0)) *
    2
  );
}
