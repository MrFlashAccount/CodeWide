import { privateAssetCacheKey } from "../../../data/private-transfer";
import {
  effectiveSessionKind,
  effectiveThreadChanges,
} from "../../../data/sessionChangeVisibility";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../../data/workspace-resource-database";
import {
  useAsyncResource,
  useEphemeralAsyncResource,
} from "../../../rendering/async-resource-store";
import type { CodeReviewLineReference } from "../comments/reviewComment";
import { codeReviewWorkspaceRevision, type CodeReviewFileItem } from "../editor/editorBridge";
import type { CodeReviewFileResource } from "../resources/reviewFiles";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { reviewTreePath } from "../resources/reviewLocation";
import {
  estimateCodeReviewResourceWeight,
  loadCodeReviewResource,
  type CodeReviewResourceValue,
} from "../resources/reviewResource";

export function useCodeReviewResources(
  props: CodeReviewWorkspaceProps,
  resourceOwnerId: string,
  requestedScope: ThreadChangeScope,
  scopeRevision: number,
  selectedPath: string | null,
) {
  const {
    changes: initialChanges,
    changeScope: initialChangeScope = "session",
    changeScopes: initialChangeScopes = ["session", "lastTurn"],
    cwd,
    getTransferAccess,
    initialColumn,
    initialLine,
    initialPath,
    onInitialLoad,
    onLoadDiff,
    onLoadScope,
    sourceAssets,
    sourceOverrides,
    thread,
  } = props;
  const shouldLoadInitialScope =
    requestedScope === initialChangeScope && onInitialLoad !== undefined;
  const shouldLoadAlternateScope =
    requestedScope !== initialChangeScope && onLoadScope !== undefined;
  const scopeResource = useAsyncResource<ThreadResourcesValue>(
    shouldLoadInitialScope || shouldLoadAlternateScope
      ? `code-review-scope:${resourceOwnerId}:${thread?.id ?? "none"}`
      : null,
    `${requestedScope}:${String(scopeRevision)}`,
    async () => {
      if (shouldLoadInitialScope) {
        return onInitialLoad();
      }
      if (shouldLoadAlternateScope) {
        return onLoadScope(requestedScope);
      }
      throw new Error("Code review scope loader is unavailable");
    },
  );
  const loadedScope = scopeResource.value;
  const scopeChanges: readonly CodeReviewFileResource[] =
    loadedScope === null
      ? initialChanges
      : loadedScope.changes.map((change) =>
          initialChanges.some(
            (initial) => initial.path === change.path && initial.sourceOnly === true,
          )
            ? { ...change, sourceOnly: true }
            : change,
        );
  const changeScope = loadedScope?.changeScope ?? initialChangeScope;
  const changes = effectiveThreadChanges(scopeChanges, changeScope);
  const changeScopes = loadedScope?.changeScopes ?? initialChangeScopes;
  const scopeLoading = scopeResource.status === "loading";
  const revealReference: CodeReviewLineReference | null =
    initialPath !== undefined && initialLine !== undefined
      ? {
          coordinate: "file",
          line: initialLine,
          path: initialPath,
          side: "new",
          ...(initialColumn === undefined ? {} : { column: initialColumn }),
        }
      : null;
  const selectedChange =
    changes.find((change) => change.path === selectedPath) ?? changes[0] ?? null;
  const effectiveSelectedPath = selectedChange?.path ?? null;
  const sourceAsset = selectedChange === null ? undefined : sourceAssets?.[selectedChange.path];
  const documentRevision =
    selectedChange === null
      ? "none"
      : `${changeScope}:${selectedChange.turnId}:${selectedChange.itemId}:${String(selectedChange.additions)}:${String(selectedChange.deletions)}:${selectedChange.availability}:${selectedChange.sourceOnly === true ? "source" : "diff"}:${sourceOverrides?.[selectedChange.path] ?? "remote"}`;
  const documentResource = useEphemeralAsyncResource<CodeReviewResourceValue>(
    selectedChange === null
      ? null
      : `code-review:${resourceOwnerId}:${thread?.id ?? "none"}:${selectedChange.path}`,
    `${documentRevision}:${sourceAsset === undefined ? "host-path" : privateAssetCacheKey(sourceAsset)}`,
    async (publish, signal) => {
      if (selectedChange === null) {
        throw new Error("No changed file selected");
      }
      return loadCodeReviewResource(
        selectedChange,
        changeScope,
        getTransferAccess,
        onLoadDiff,
        signal,
        sourceOverrides,
        publish,
        sourceAsset,
      );
    },
    estimateCodeReviewResourceWeight,
  );
  const document = documentResource.value?.document ?? null;
  const hasDiff = document !== null && document.patches.length > 0;
  const loadError = documentResource.error ?? scopeResource.error;
  const documentWarning = documentResource.value?.warning ?? null;
  const diffTruncated = documentResource.value?.diffTruncated ?? false;
  const loading = documentResource.status === "loading" || documentResource.status === "idle";
  const selectedKind =
    selectedChange === null ? null : effectiveSessionKind(selectedChange, changeScope);
  const documentStatus =
    selectedChange === null
      ? null
      : selectedChange.sourceOnly === true
        ? "Attached file"
        : selectedKind === "delete"
          ? "Deleted file"
          : selectedKind === "add"
            ? "New file"
            : diffTruncated
              ? "Diff truncated"
              : documentWarning !== null
                ? "Current file"
                : null;
  const reviewFiles: CodeReviewFileItem[] = changes.map((change) => {
    const kind = effectiveSessionKind(change, changeScope);
    return {
      additions: change.additions,
      countsAreNet: changeScope !== "session" && changeScope !== "lastTurn",
      deletions: change.deletions,
      path: change.path,
      sourceOnly: change.sourceOnly === true,
      status: kind === "add" ? "added" : kind === "delete" ? "deleted" : "modified",
      treePath: reviewTreePath(change.path, cwd),
    };
  });
  const workspaceRevision = codeReviewWorkspaceRevision(reviewFiles);
  return {
    changes,
    changeScope,
    changeScopes,
    document,
    documentStatus,
    effectiveSelectedPath,
    hasDiff,
    loadError,
    loading,
    revealReference,
    reviewFiles,
    scopeLoading,
    workspaceRevision,
  };
}
