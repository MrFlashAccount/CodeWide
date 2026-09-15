import { computed, observablePrimitive, type ObservableComputed } from "@legendapp/state";

import type { NewChatWorkspaceMode } from "../../data/workspace-creation";
import { SearchConversationWindow } from "../search/search-conversation-window";

export type NewChatDraft = {
  id: string;
  serverId: string;
  cwd: string | null;
  workspaceMode: NewChatWorkspaceMode;
};

/** A destination owns its draft or search window; neither can leak into another chat. */
export type ConversationDestination =
  | { kind: "empty"; generation: number }
  | {
      kind: "thread";
      generation: number;
      key: string;
      searchWindow: SearchConversationWindow | null;
    }
  | { kind: "draft"; generation: number; draft: NewChatDraft };

type ThreadNavigationSelection = {
  id: string | null;
  generation: number;
};

export type ThreadNavigationModel = {
  destination$: ReturnType<typeof observablePrimitive<ConversationDestination>>;
  selection$: ObservableComputed<ThreadNavigationSelection>;
  current(): ThreadNavigationSelection;
  select(id: string | null, reloadSelected?: boolean): ThreadNavigationSelection;
  openSearch(key: string, searchWindow: SearchConversationWindow | null): void;
  exitSearch(): void;
  openDraft(draft: NewChatDraft): void;
  changeDraftProject(draftId: string, cwd: string | null): void;
  changeDraftWorkspaceMode(draftId: string, workspaceMode: NewChatWorkspaceMode): void;
};

/**
 * Navigation state is published atomically. The conversation host observes the
 * destination, while list rows observe only whether their identity is selected.
 * This model does not load data or own the destination's rendering boundary.
 */
export function createThreadNavigationModel(): ThreadNavigationModel {
  const destination$ = observablePrimitive<ConversationDestination>({
    kind: "empty",
    generation: 0,
  });
  const selection$ = computed<ThreadNavigationSelection>(() => {
    const destination = destination$.get();
    return {
      id: destination.kind === "thread" ? destination.key : null,
      generation: destination.generation,
    };
  });
  return {
    destination$,
    selection$,
    current: () => selection$.peek(),
    select(id, reloadSelected = false) {
      const current = selection$.peek();
      const destination = destination$.peek();
      if (current.id === id && !reloadSelected && destination.kind !== "draft") return current;
      destination$.set(
        id === null
          ? { kind: "empty", generation: current.generation + 1 }
          : { kind: "thread", generation: current.generation + 1, key: id, searchWindow: null },
      );
      return selection$.peek();
    },
    openSearch(key, searchWindow) {
      destination$.set({
        kind: "thread",
        generation: destination$.peek().generation + 1,
        key,
        searchWindow,
      });
    },
    exitSearch() {
      const destination = destination$.peek();
      if (destination.kind !== "thread" || destination.searchWindow === null) return;
      destination$.set({ ...destination, searchWindow: null });
    },
    openDraft(draft) {
      destination$.set({ kind: "draft", generation: destination$.peek().generation + 1, draft });
    },
    changeDraftProject(draftId, cwd) {
      const destination = destination$.peek();
      if (destination.kind !== "draft" || destination.draft.id !== draftId) return;
      destination$.set({
        ...destination,
        draft: { ...destination.draft, cwd, workspaceMode: "current" },
      });
    },
    changeDraftWorkspaceMode(draftId, workspaceMode) {
      const destination = destination$.peek();
      if (destination.kind !== "draft" || destination.draft.id !== draftId) return;
      destination$.set({ ...destination, draft: { ...destination.draft, workspaceMode } });
    },
  };
}

export type SelectWorkspaceThread = (
  value: string | null,
  navigationId?: string,
  nextServerId?: string,
  reloadSelected?: boolean,
) => void;
