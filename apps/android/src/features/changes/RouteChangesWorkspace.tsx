import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import {
  recordedTurnChangeDiff,
  recordedTurnChangeResources,
  recordedTurnResourcesValue,
} from "./changePresentation";
import { CodeReviewWorkspace } from "../review/workspace/CodeReviewWorkspace";
import type {
  CurrentChangesRouteRequest,
  TurnChangesRouteRequest,
} from "../../services/changes/changesRouteSession";
import type { ThreadChangeResource } from "../../data/thread-resource-types";

const EMPTY_CHANGES: ThreadChangeResource[] = [];
const DEFAULT_CHANGE_SCOPES: ThreadChangeScope[] = ["session", "lastTurn"];
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
  const scope = currentChangeScope(request);
  return {
    changes: currentChanges(request),
    changeScope: currentResourceScope(request, scope),
    changeScopes: currentChangeScopes(request),
    scope,
  };
}

function currentChangeScope(request: CurrentChangesRouteRequest): ThreadChangeScope {
  return request.preferences.scope ?? request.initialResource?.changeScope ?? "session";
}

function currentChanges(request: CurrentChangesRouteRequest): ThreadChangeResource[] {
  return request.initialResource?.changes ?? EMPTY_CHANGES;
}

function currentResourceScope(
  request: CurrentChangesRouteRequest,
  fallback: ThreadChangeScope,
): ThreadChangeScope {
  return request.initialResource?.changeScope ?? fallback;
}

function currentChangeScopes(request: CurrentChangesRouteRequest): ThreadChangeScope[] {
  return request.initialResource?.changeScopes ?? DEFAULT_CHANGE_SCOPES;
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
  const loadFiles = async () => {
    if (request.knownFiles.length > 0) {
      return request.knownFiles;
    }
    if (request.loadTurnChanges === undefined) {
      throw new Error("This turn has no recorded file patches.");
    }
    const files = await request.loadTurnChanges(request.target);
    if (files.length === 0) {
      throw new Error("This turn has no recorded file patches.");
    }
    return files;
  };
  const changes = recordedTurnChangeResources(request.target, request.knownFiles);
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
      onLoadDiff={async (path) => recordedTurnChangeDiff(request.target, await loadFiles(), path)}
      scopeLabel="This turn"
      thread={request.thread}
      voiceRuntime={request.voiceRuntime}
      {...(request.knownFiles.length > 0
        ? {}
        : {
            onInitialLoad: async () =>
              recordedTurnResourcesValue(request.target, await loadFiles()),
          })}
    />
  );
}
