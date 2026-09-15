import {
  type ThreadChangeScope,
  type ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { codeReviewFilesForDocument } from "../review/code-review-files";
import { CodeReviewWorkspace } from "../review/CodeReviewWorkspace";
import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { type TurnChangedFile } from "../../rendering/turn-changes";
import { type TurnChangesTarget } from "../../rendering/TurnChangesContext";
import { useAppDialog } from "../../ui/AppDialog";
import type { ChangePresentationCapabilities } from "./changeCapabilities";
import {
  recordedTurnChangeDiff,
  recordedTurnChangeResources,
  recordedTurnResourcesValue,
} from "./changePresentation";
export function useChangesFeature({
  cwd,
  remoteThread,
  changesPreferences,
  setChangesPreferences,
  dismissComposerKeyboardForOverlay,
  fullscreenOverlay,
  appVoiceInputRuntime,
  getStableTransferAccess,
  attachCodeReview,
  onLoadTurnChanges,
  onLoadThreadResources,
  onLoadThreadChangeDiff,
  currentThreadResources,
  currentChangePresentation,
}: ChangePresentationCapabilities) {
  const dialog = useAppDialog();
  const downloadDocument = useDocumentDownload();
  const presentThreadChanges = useEvent(
    (resource: ThreadResourcesValue | null, refreshOnOpen = false) => {
      const presentation = currentChangePresentation();
      fullscreenOverlay.present(({ close }) => (
        <CodeReviewWorkspace
          changes={resource?.changes ?? []}
          changeScope={resource?.changeScope ?? presentation.scope}
          changeScopes={resource?.changeScopes ?? presentation.scopes}
          initialMode={changesPreferences.mode}
          initialWrapLines={changesPreferences.wrapLines}
          cwd={cwd}
          thread={remoteThread ?? null}
          voiceRuntime={appVoiceInputRuntime}
          getTransferAccess={getStableTransferAccess}
          onAttach={attachCodeReview}
          onClose={close}
          onPreferencesChange={(preferences) => setChangesPreferences(preferences)}
          {...(!refreshOnOpen || onLoadThreadResources === undefined
            ? {}
            : {
                onInitialLoad: () =>
                  onLoadThreadResources(changesPreferences.scope ?? undefined, "changes"),
              })}
          {...(onLoadThreadResources === undefined
            ? {}
            : {
                onLoadScope: (scope: ThreadChangeScope) => onLoadThreadResources(scope, "changes"),
              })}
          {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
        />
      ));
    },
  );
  const openChangesResource = useEvent(() => {
    dismissComposerKeyboardForOverlay();
    const { resource } = currentChangePresentation();
    if (onLoadThreadResources === undefined) {
      if (resource === null) return;
      presentThreadChanges(resource);
      return;
    }
    presentThreadChanges(resource, true);
    return;
  });

  const presentTurnChanges = useEvent(
    (target: TurnChangesTarget, knownFiles: readonly TurnChangedFile[]) => {
      dismissComposerKeyboardForOverlay();
      let filesPromise: Promise<readonly TurnChangedFile[]>;
      if (knownFiles.length > 0) filesPromise = Promise.resolve(knownFiles);
      else {
        if (onLoadTurnChanges === undefined) {
          dialog.alert("Changes unavailable", "This turn has no recorded file patches.");
          return;
        }
        filesPromise = onLoadTurnChanges(target);
      }
      const loadFiles = async () => {
        const files = await filesPromise;
        if (files.length === 0) throw new Error("This turn has no recorded file patches.");
        return files;
      };
      fullscreenOverlay.present(({ close }) => (
        <CodeReviewWorkspace
          changes={recordedTurnChangeResources(target, knownFiles)}
          changeScope="lastTurn"
          changeScopes={[]}
          scopeLabel="This turn"
          initialMode="unified"
          initialWrapLines={changesPreferences.wrapLines}
          cwd={cwd}
          thread={remoteThread ?? null}
          voiceRuntime={appVoiceInputRuntime}
          getTransferAccess={getStableTransferAccess}
          onLoadDiff={async (path) => recordedTurnChangeDiff(target, await loadFiles(), path)}
          onAttach={attachCodeReview}
          onClose={close}
          {...(knownFiles.length > 0
            ? {}
            : {
                onInitialLoad: async () => recordedTurnResourcesValue(target, await loadFiles()),
              })}
        />
      ));
    },
  );

  const openCodeDocument = useEvent((request: DocumentPreviewRequest) => {
    const resource = currentThreadResources()?.value ?? null;
    fullscreenOverlay.present(({ close }) => (
      <CodeReviewWorkspace
        key={`${request.path}:${request.line ?? ""}:${request.column ?? ""}`}
        changes={codeReviewFilesForDocument(resource?.changes ?? [], request.path)}
        {...(request.source === undefined
          ? {}
          : { sourceAssets: { [request.path]: request.source } })}
        initialPath={request.path}
        {...(request.line === undefined ? {} : { initialLine: request.line })}
        {...(request.column === undefined ? {} : { initialColumn: request.column })}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceRuntime={appVoiceInputRuntime}
        getTransferAccess={getStableTransferAccess}
        onAttach={attachCodeReview}
        onClose={close}
        onDownload={() => void downloadDocument(request)}
        {...(onLoadThreadChangeDiff === undefined
          ? {}
          : { onLoadDiff: (path: string) => onLoadThreadChangeDiff(path, resource?.changeScope) })}
      />
    ));
  });
  return { openChangesResource, presentTurnChanges, openCodeDocument };
}
