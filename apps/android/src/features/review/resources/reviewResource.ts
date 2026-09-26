import {
  UnsupportedPrivateTextFormatError,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../../data/thread-resource-types";
import type { ThreadChangeScope } from "../../../data/workspace-resource-database";
import { effectiveSessionKind } from "../../../data/sessionChangeVisibility";
import { remoteFileKind } from "../../../rendering/document-preview";
import { codeReviewDocumentRevision, type CodeReviewDocument } from "../editor/editorBridge";
import { loadDocumentPreview } from "../../../rendering/DocumentPreviewHost";
import { loadReviewImage } from "./loadReviewImage";
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
  const finalKind = effectiveSessionKind(change, changeScope);
  if (sourceOverrides?.[change.path] === undefined) {
    const kind = remoteFileKind(change.path, change.path);
    if (kind === "download") {
      return unsupportedReviewResource(change.path);
    }
    if (
      kind === "image" &&
      finalKind !== "delete" &&
      (change.availability === "available" || change.availability === "unknown")
    ) {
      const imageDataUrl = await loadReviewImage(
        sourceAsset ?? { kind: "path", path: change.path },
        getTransferAccess,
        signal,
      );
      const document: CodeReviewDocument = {
        displayState: "image",
        imageDataUrl,
        patches: [],
        path: change.path,
        revision: codeReviewDocumentRevision(change.path, imageDataUrl, [], "image"),
        source: "",
      };
      return { diffTruncated: false, document, warning: null };
    }
  }
  const fullFileDiff = usesCompleteFile(changeScope);
  const sourcePromise = readReviewSource({
    change,
    fullFileDiff,
    getTransferAccess,
    signal,
    sourceAsset,
    sourceOverrides,
  });
  let diffFailed = false;
  const diffPromise =
    onLoadDiff === undefined || change.sourceOnly === true
      ? Promise.resolve<ThreadChangeDiffValue | null>(null)
      : onLoadDiff(change.path, changeScope).catch(() => {
          diffFailed = true;
          return null;
        });
  let fallbackSource: string;
  try {
    fallbackSource = await resolveReviewSource({
      diffPromise,
      fullFileDiff,
      signal,
      sourcePromise,
    });
  } catch (error) {
    if (!signal.aborted && error instanceof UnsupportedPrivateTextFormatError) {
      return unsupportedReviewResource(change.path);
    }
    throw error;
  }
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const deleted = finalKind === "delete" || change.availability === "deleted";
  const sourceDisplayState: CodeReviewDocument["displayState"] = deleted
    ? "deleted"
    : fallbackSource === ""
      ? "empty"
      : undefined;
  const sourceDocument: CodeReviewDocument = {
    ...(fullFileDiff ? { fullFileDiff } : {}),
    patches: [],
    path: change.path,
    source: fallbackSource,
    ...(sourceDisplayState === undefined ? {} : { displayState: sourceDisplayState }),
    revision: `${codeReviewDocumentRevision(change.path, fallbackSource, [], sourceDisplayState)}${fullFileDiff ? ":full" : ""}`,
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
    ...(fullFileDiff ? { fullFileDiff } : {}),
    patches,
    path: change.path,
    source,
    ...(displayState === undefined ? {} : { displayState }),
    revision: `${codeReviewDocumentRevision(change.path, source, patches, displayState)}${fullFileDiff ? ":full" : ""}`,
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

function unsupportedReviewResource(path: string): CodeReviewResourceValue {
  const document: CodeReviewDocument = {
    displayState: "unsupported",
    patches: [],
    path,
    revision: codeReviewDocumentRevision(path, "", [], "unsupported"),
    source: "",
  };
  return { diffTruncated: false, document, warning: null };
}

function usesCompleteFile(scope: ThreadChangeScope): boolean {
  return scope === "session" || scope === "uncommitted" || scope === "branch";
}

async function resolveReviewSource({
  diffPromise,
  fullFileDiff,
  signal,
  sourcePromise,
}: {
  diffPromise: Promise<ThreadChangeDiffValue | null>;
  fullFileDiff: boolean;
  signal: AbortSignal;
  sourcePromise: Promise<string>;
}): Promise<string> {
  if (!fullFileDiff) {
    return sourcePromise;
  }
  try {
    return await sourcePromise;
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    if (error instanceof UnsupportedPrivateTextFormatError) {
      throw error;
    }
    // VCS scopes can return the complete file with the diff even if the
    // separate private-file request fails through the relay.
    const source = (await diffPromise)?.source;
    if (source === null || source === undefined) {
      throw error;
    }
    return source;
  }
}

async function readReviewSource({
  change,
  fullFileDiff,
  getTransferAccess,
  signal,
  sourceAsset,
  sourceOverrides,
}: {
  change: CodeReviewFileResource;
  fullFileDiff: boolean;
  getTransferAccess: GetTransferAccess;
  signal: AbortSignal;
  sourceAsset: PrivateAssetSource | undefined;
  sourceOverrides: Readonly<Record<string, string>> | undefined;
}): Promise<string> {
  const override = sourceOverrides?.[change.path];
  if (override !== undefined) {
    return override;
  }
  if (change.availability !== "available" && change.availability !== "unknown") {
    return unavailableReviewSource(change.availability, fullFileDiff);
  }
  return readAvailableReviewSource({
    change,
    fullFileDiff,
    getTransferAccess,
    signal,
    sourceAsset,
  });
}

function unavailableReviewSource(
  availability: CodeReviewFileResource["availability"],
  fullFileDiff: boolean,
): string {
  if (availability === "deleted") {
    return "";
  }
  if (fullFileDiff) {
    throw new Error("File is unavailable");
  }
  return "// File is unavailable\n";
}

async function readAvailableReviewSource({
  change,
  fullFileDiff,
  getTransferAccess,
  signal,
  sourceAsset,
}: {
  change: CodeReviewFileResource;
  fullFileDiff: boolean;
  getTransferAccess: GetTransferAccess;
  signal: AbortSignal;
  sourceAsset: PrivateAssetSource | undefined;
}): Promise<string> {
  try {
    const loaded = await loadDocumentPreview(
      {
        getTransferAccess,
        kind: "text",
        name: change.path.split("/").at(-1) ?? change.path,
        path: change.path,
        ...(sourceAsset === undefined ? {} : { source: sourceAsset }),
      },
      signal,
    );
    return loaded.source;
  } catch (error) {
    if (signal.aborted || fullFileDiff || error instanceof UnsupportedPrivateTextFormatError) {
      throw error;
    }
    return `// Current file could not be loaded\n// ${error instanceof Error ? error.message : "File preview failed"}\n`;
  }
}

export function estimateCodeReviewResourceWeight(value: CodeReviewResourceValue): number {
  return (
    (value.document.source.length +
      (value.document.displayState === "image" ? value.document.imageDataUrl.length : 0) +
      value.document.patches.reduce((sum, patch) => sum + patch.diff.length, 0)) *
    2
  );
}
