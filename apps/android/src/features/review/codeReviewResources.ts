import { privateAssetCacheKey } from "../../data/private-transfer";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import { useAsyncResource, useEphemeralAsyncResource } from "../../rendering/async-resource-store";
import type { CodeReviewLineReference } from "../../rendering/code-review";
import {
  codeReviewWorkspaceRevision,
  type CodeReviewFileItem,
} from "../../rendering/code-review-bridge";
import type { CodeReviewFileResource } from "./code-review-files";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { reviewTreePath } from "./reviewLocation";
import {
  estimateCodeReviewResourceWeight,
  loadCodeReviewResource,
  type CodeReviewResourceValue,
} from "./reviewResource";

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
    initialPath,
    initialLine,
    initialColumn,
    cwd,
    thread,
    getTransferAccess,
    sourceOverrides,
    sourceAssets,
    onLoadDiff,
    onInitialLoad,
    onLoadScope,
  } = props;
  const shouldLoadInitialScope =
    requestedScope === initialChangeScope && onInitialLoad !== undefined;
  const shouldLoadAlternateScope =
    requestedScope !== initialChangeScope && onLoadScope !== undefined;
  const scopeResource = useAsyncResource<ThreadResourcesValue>(
    shouldLoadInitialScope || shouldLoadAlternateScope
      ? `code-review-scope:${resourceOwnerId}:${thread?.id ?? "none"}`
      : null,
    `${requestedScope}:${scopeRevision}`,
    async () =>
      shouldLoadInitialScope ? await onInitialLoad!() : await onLoadScope!(requestedScope),
  );
  const loadedScope = scopeResource.value;
  const changes: readonly CodeReviewFileResource[] =
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
  const changeScopes = loadedScope?.changeScopes ?? initialChangeScopes;
  const scopeLoading = scopeResource.status === "loading";
  const revealReference: CodeReviewLineReference | null =
    initialPath !== undefined && initialLine !== undefined
      ? {
          path: initialPath,
          line: initialLine,
          side: "new",
          coordinate: "file",
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
      : `${changeScope}:${selectedChange.turnId}:${selectedChange.itemId}:${selectedChange.additions}:${selectedChange.deletions}:${selectedChange.availability}:${selectedChange.sourceOnly === true ? "source" : "diff"}:${sourceOverrides?.[selectedChange.path] ?? "remote"}`;
  const documentResource = useEphemeralAsyncResource<CodeReviewResourceValue>(
    selectedChange === null
      ? null
      : `code-review:${resourceOwnerId}:${thread?.id ?? "none"}:${selectedChange.path}`,
    `${documentRevision}:${sourceAsset === undefined ? "host-path" : privateAssetCacheKey(sourceAsset)}`,
    async (publish, signal) => {
      if (selectedChange === null) throw new Error("No changed file selected");
      return await loadCodeReviewResource(
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
  const documentStatus =
    selectedChange === null
      ? null
      : selectedChange.sourceOnly === true
        ? "Attached file"
        : selectedChange.kind === "delete" || selectedChange.availability === "deleted"
          ? "Deleted file"
          : selectedChange.kind === "add"
            ? "New file"
            : diffTruncated
              ? "Diff truncated"
              : documentWarning !== null
                ? "Current file"
                : null;
  const reviewFiles: CodeReviewFileItem[] = changes.map((change) => ({
    path: change.path,
    treePath: reviewTreePath(change.path, cwd),
    status:
      change.kind === "add"
        ? ("added" as const)
        : change.kind === "delete"
          ? ("deleted" as const)
          : ("modified" as const),
    additions: change.additions,
    deletions: change.deletions,
    sourceOnly: change.sourceOnly === true,
  }));
  const workspaceRevision = codeReviewWorkspaceRevision(reviewFiles);
  return {
    changes,
    changeScope,
    changeScopes,
    scopeLoading,
    revealReference,
    effectiveSelectedPath,
    document,
    hasDiff,
    loadError,
    loading,
    documentStatus,
    reviewFiles,
    workspaceRevision,
  };
}
