import { useEvent } from "../../react/useEvent";
/** V1 changePresentation owner, extracted without changing interaction or resource lifetime. */
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type {
  ThreadChangeResource,
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import { isSelectableChangeScope, selectableChangeScopes } from "../../rendering/change-menu";

type ChangesDisplayMode = "unified" | "split" | "source";

const DEFAULT_CHANGE_SCOPES: ThreadChangeScope[] = ["session"];

export type ChangesPreferences = {
  mode: ChangesDisplayMode;
  scope: ThreadChangeScope | null;
  wrapLines: boolean;
};

const changesPreferencesByThread = new Map<string, ChangesPreferences>();

function readChangesPreferences(key: string): ChangesPreferences {
  const stored = changesPreferencesByThread.get(key);
  return stored === undefined
    ? { mode: "unified", scope: null, wrapLines: false }
    : selectableChangesPreferences(stored);
}

function selectableChangesPreferences(preferences: ChangesPreferences): ChangesPreferences {
  return preferences.scope === null || isSelectableChangeScope(preferences.scope)
    ? preferences
    : { mode: preferences.mode, scope: null, wrapLines: preferences.wrapLines };
}

export function recordedTurnChangeResources(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
): ThreadChangeResource[] {
  const resources: ThreadChangeResource[] = [];
  const indexesByPath = new Map<string, number>();
  for (const file of files) {
    const existingIndex = indexesByPath.get(file.path);
    if (existingIndex === undefined) {
      indexesByPath.set(file.path, resources.length);
      resources.push({
        additions: file.additions,
        availability: file.kind === "delete" ? "deleted" : "unavailable",
        deletions: file.deletions,
        itemId: file.itemId,
        kind: file.kind,
        path: file.path,
        turnId: target.turnId,
      });
      continue;
    }
    const existing = resources[existingIndex];
    if (existing === undefined) {
      continue;
    }
    existing.kind = file.kind;
    existing.availability = file.kind === "delete" ? "deleted" : "unavailable";
    existing.additions += file.additions;
    existing.deletions += file.deletions;
    existing.itemId = file.itemId;
  }
  return resources;
}

export function recordedTurnChangeDiff(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
  path: string,
): ThreadChangeDiffValue {
  const patches: ThreadChangeDiffValue["patches"] = [];
  for (const file of files) {
    if (file.path !== path) {
      continue;
    }
    patches.push({
      diff: file.patch,
      itemId: file.itemId,
      kind: file.kind,
      turnId: target.turnId,
    });
  }
  return {
    changeScope: "lastTurn",
    patches,
    path,
    source: "",
    threadId: target.threadId,
    truncated: false,
  };
}

export function recordedTurnResourcesValue(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
): ThreadResourcesValue {
  return {
    attachments: [],
    changes: recordedTurnChangeResources(target, files),
    changeScope: "lastTurn",
    changeScopes: [],
    revision: target.turnId,
    threadId: target.threadId,
  };
}

import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import type { ThreadResourcesRow } from "../../data/workspace-resource-database";
import { useConversationState } from "../../ui/use-conversation-scope";

export function useChangesPreferences(composerScope: string) {
  const [changesPreferencesState, setChangesPreferencesState] = useConversationState(
    composerScope,
    () => ({
      key: composerScope,
      value: readChangesPreferences(composerScope),
    }),
  );

  const changesPreferences = selectableChangesPreferences(
    changesPreferencesState.key === composerScope
      ? changesPreferencesState.value
      : readChangesPreferences(composerScope),
  );

  const setChangesPreferences = useEvent((next: ChangesPreferences) => {
    const selected = selectableChangesPreferences(next);
    changesPreferencesByThread.set(composerScope, selected);
    setChangesPreferencesState({ key: composerScope, value: selected });
  });
  return { changesPreferences, setChangesPreferences };
}

export function useChangeResourcePresentation(
  threadResourcesModel: ThreadResourcesModel | null,
  threadResourceId: string | null,
  changesPreferences: ChangesPreferences,
) {
  const currentThreadResources = useEvent((): ThreadResourcesRow | null =>
    threadResourcesModel === null || threadResourceId === null
      ? null
      : (threadResourcesModel.get(threadResourceId) ?? null),
  );

  const currentChangePresentation = useEvent(() =>
    selectChangePresentation(currentThreadResources()?.value ?? null, changesPreferences.scope),
  );
  return { currentChangePresentation, currentThreadResources };
}

/** Selects only resource data that belongs to the active Changes scope. */
export function selectChangePresentation(
  resource: ThreadResourcesValue | null,
  preferredScope: ThreadChangeScope | null,
): {
  resource: ThreadResourcesValue | null;
  scope: ThreadChangeScope;
  scopes: ThreadChangeScope[];
} {
  const scopes = selectableChangeScopes(resource?.changeScopes ?? DEFAULT_CHANGE_SCOPES);
  const scope =
    preferredScope !== null && scopes.includes(preferredScope)
      ? preferredScope
      : resource !== null && scopes.includes(resource.changeScope)
        ? resource.changeScope
        : (scopes[0] ?? "session");
  return {
    resource: resource?.changeScope === scope ? resource : null,
    scope,
    scopes,
  };
}
