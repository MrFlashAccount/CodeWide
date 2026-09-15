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

export type ChangesDisplayMode = "unified" | "split" | "source";

export type ChangesPreferences = {
  scope: ThreadChangeScope | null;
  mode: ChangesDisplayMode;
  wrapLines: boolean;
};

export const changesPreferencesByThread = new Map<string, ChangesPreferences>();

export function readChangesPreferences(key: string): ChangesPreferences {
  return changesPreferencesByThread.get(key) ?? { scope: null, mode: "unified", wrapLines: false };
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
        path: file.path,
        kind: file.kind,
        availability: file.kind === "delete" ? "deleted" : "unavailable",
        additions: file.additions,
        deletions: file.deletions,
        turnId: target.turnId,
        itemId: file.itemId,
      });
      continue;
    }
    const existing = resources[existingIndex];
    if (existing === undefined) continue;
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
    if (file.path !== path) continue;
    patches.push({
      turnId: target.turnId,
      itemId: file.itemId,
      kind: file.kind,
      diff: file.patch,
    });
  }
  return {
    threadId: target.threadId,
    path,
    changeScope: "lastTurn",
    patches,
    source: "",
    truncated: false,
  };
}

export function recordedTurnResourcesValue(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
): ThreadResourcesValue {
  return {
    threadId: target.threadId,
    revision: target.turnId,
    changeScope: "lastTurn",
    changeScopes: [],
    changes: recordedTurnChangeResources(target, files),
    attachments: [],
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

  const changesPreferences =
    changesPreferencesState.key === composerScope
      ? changesPreferencesState.value
      : readChangesPreferences(composerScope);

  const setChangesPreferences = useEvent((next: ChangesPreferences) => {
    changesPreferencesByThread.set(composerScope, next);
    setChangesPreferencesState({ key: composerScope, value: next });
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

  const currentChangePresentation = useEvent(() => {
    const resource = currentThreadResources()?.value ?? null;
    const scopes = resource?.changeScopes ?? ["session" as const, "lastTurn" as const];
    const scope =
      changesPreferences.scope !== null && scopes.includes(changesPreferences.scope)
        ? changesPreferences.scope
        : (resource?.changeScope ?? scopes[0] ?? "session");
    return { resource, scopes, scope };
  });
  return { currentThreadResources, currentChangePresentation };
}
