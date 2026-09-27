import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import {
  recordedTurnChangeDiff,
  recordedTurnChangeResources,
  recordedTurnResourcesValue,
  loadRecordedTurnChanges,
  selectChangePresentation,
} from "./changePresentation";
import { CodeReviewWorkspace } from "../review/workspace/CodeReviewWorkspace";
import type {
  CurrentChangesRouteRequest,
  TurnChangesRouteRequest,
} from "../../services/changes/changesRouteSession";
import type { ThreadChangeResource } from "../../data/thread-resource-types";
import { useEvent } from "../../react/useEvent";

const EMPTY_CHANGES: ThreadChangeResource[] = [];
const LAST_TURN_CHANGE_SCOPES: ThreadChangeScope[] = [];

/** Renders current-thread review state captured by one route activation. */
export function CurrentChangesRoute({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: CurrentChangesRouteRequest;
}): React.JSX.Element {
  const presentation = currentChangesPresentation(request);
  const scope = presentation.scope;
  const loading = currentChangesLoading(request, scope);
  const diff = currentChangesDiff(request);
  return (
    <CodeReviewWorkspace
      changes={presentation.changes}
      changeScope={presentation.changeScope}
      changeScopes={presentation.changeScopes}
      cwd={request.cwd}
      getTransferAccess={request.getTransferAccess}
      initialMode={request.preferences.mode}
      initialWrapLines={request.preferences.wrapLines}
      onAttach={request.attachCodeReview}
      onClose={onClose}
      onPreferencesChange={request.setPreferences}
      thread={request.thread}
      voiceRuntime={request.voiceRuntime}
      {...loading}
      {...diff}
    />
  );
}

function currentChangesPresentation(request: CurrentChangesRouteRequest): {
  readonly changes: ThreadChangeResource[];
  readonly changeScope: ThreadChangeScope;
  readonly changeScopes: ThreadChangeScope[];
  readonly scope: ThreadChangeScope;
} {
  const selected = selectChangePresentation(request.initialResource, request.preferences.scope);
  return {
    changes: selected.resource?.changes ?? EMPTY_CHANGES,
    changeScope: selected.scope,
    changeScopes: selected.scopes,
    scope: selected.scope,
  };
}

function currentChangesDiff(request: CurrentChangesRouteRequest): {
  readonly onLoadDiff?: NonNullable<CurrentChangesRouteRequest["loadDiff"]>;
} {
  return request.loadDiff === undefined ? {} : { onLoadDiff: request.loadDiff };
}

function currentChangesLoading(
  request: CurrentChangesRouteRequest,
  scope: ThreadChangeScope,
): {
  readonly onInitialLoad?: () => Promise<ThreadResourcesValue>;
  readonly onLoadScope?: (nextScope: ThreadChangeScope) => Promise<ThreadResourcesValue>;
} {
  if (request.loadResources === undefined) {
    return {};
  }
  const loadResources = request.loadResources;
  return {
    onInitialLoad: async () => loadResources(scope, "changes"),
    onLoadScope: async (nextScope) => loadResources(nextScope, "changes"),
  };
}

/** Renders the recorded patches for one Router-qualified turn. */
export function TurnChangesRoute({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: TurnChangesRouteRequest;
}): React.JSX.Element {
  const loadFiles = useEvent(async () => loadRecordedTurnChanges(request));
  const loadDiff = useEvent(async (path: string) =>
    recordedTurnChangeDiff(request.target, await loadFiles(), path),
  );
  const loadInitial = useEvent(async () =>
    recordedTurnResourcesValue(request.target, await loadFiles()),
  );
  // The turn footer carries a bounded diff preview. Its hunk may be cut in
  // half, so wait for full recorded fileChange items before selecting a file.
  const changes = recordedTurnChangeResources(
    request.target,
    request.loadTurnChanges === undefined ? request.knownFiles : [],
  );
  return (
    <CodeReviewWorkspace
      changes={changes}
      changeScope="lastTurn"
      changeScopes={LAST_TURN_CHANGE_SCOPES}
      cwd={request.cwd}
      getTransferAccess={request.getTransferAccess}
      initialMode="unified"
      initialWrapLines={request.wrapLines}
      onAttach={request.attachCodeReview}
      onClose={onClose}
      onLoadDiff={loadDiff}
      scopeLabel="This turn"
      thread={request.thread}
      voiceRuntime={request.voiceRuntime}
      {...(request.loadTurnChanges === undefined
        ? {}
        : {
            onInitialLoad: loadInitial,
          })}
    />
  );
}
