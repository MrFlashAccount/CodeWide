import { KeyboardController } from "react-native-keyboard-controller";
import type { SearchContextQuery, SearchConversationPage } from "../../data/message-search";
import { recordTiming } from "../../data/operational-metrics";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import {
  beginThreadNavigation,
  markThreadNavigationStage,
} from "../../data/thread-navigation-metrics";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import { beginNavigationFrameTrace } from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";
import type { LocatedSearchHit } from "../search/GlobalSearchScreen";
import { SearchConversationWindow } from "../search/search-conversation-window";
import type { ThreadNavigationModel } from "./threadNavigation";
import { parseThreadSelectionKey, threadSelectionKey } from "./threadSelection";
/** Existing destination read owners; no runtime or mutation facade crosses navigation. */
export type NavigationReadCapability = {
  readonly native: boolean;
  readonly threadDetails: ThreadDetailDatabase | null;
  readonly threadUiStateDatabase: ThreadUiStateDatabase | null;
  observeThread(connectionId: string, threadId: string, active?: boolean): Promise<void>;
  searchConversation(
    connectionId: string,
    query: SearchContextQuery,
  ): Promise<SearchConversationPage>;
};
/** Mounted navigation intents preserve immediate selection and progressive hydration. */
export function useThreadNavigationActions(
  remote: NavigationReadCapability,
  threadNavigation: ThreadNavigationModel,
  setActiveServerId: (id: string) => void,
) {
  const setActiveThreadId = useEvent(
    (
      value: string | null,
      navigationId?: string,
      nextServerId?: string,
      reloadSelected = false,
      searchWindow: SearchConversationWindow | null = null,
    ) => {
      const requestedThreadId = threadNavigation.current().id;
      const selectedTarget = parseThreadSelectionKey(value);
      if (selectedTarget !== null) {
        void remote
          .observeThread(selectedTarget.connectionId, selectedTarget.threadId)
          .catch((cause: unknown) => {
            console.warn(
              "Could not attach thread observer:",
              cause instanceof Error ? cause.message : "unknown error",
            );
          });
      }
      if (value !== requestedThreadId) {
        // A focused search field or composer keeps the Android IME session alive
        // when the visible surface is replaced. End that session at the navigation
        // boundary so the newly selected conversation never inherits keyboard focus.
        KeyboardController.dismiss({ animated: false, keepFocus: false });
        const target = parseThreadSelectionKey(value);
        if (target !== null)
          remote.threadDetails?.chat.beginPresentation(target.connectionId, target.threadId);
      }
      // Selection is urgent: reveal the destination's cached content or its
      // local skeleton immediately. Background hydration stays model-owned.
      const startedAt = performance.now();
      if (value !== null && searchWindow !== null) threadNavigation.openSearch(value, searchWindow);
      else threadNavigation.select(value, reloadSelected);
      if (nextServerId !== undefined) setActiveServerId(nextServerId);
      requestAnimationFrame(() => {
        const elapsed = performance.now() - startedAt;
        recordTiming("thread_selection_next_frame_ms", elapsed);
        const target = parseThreadSelectionKey(value);
        if (target !== null && navigationId !== undefined) {
          markThreadNavigationStage(
            target.connectionId,
            target.threadId,
            "selection_next_frame",
            {
              values: { animationFrameDelayMs: elapsed },
            },
            navigationId,
          );
        }
        if (__DEV__)
          console.log(`[CodeWide perf] thread_selection_next_frame_ms=${Math.round(elapsed)}`);
      });
    },
  );

  const selectThread = useEvent((value: string) => {
    const target = parseThreadSelectionKey(value);
    let navigationId: string | undefined;
    if (target !== null) {
      navigationId = beginThreadNavigation(target.connectionId, target.threadId);
      void beginNavigationFrameTrace(navigationId);
    }
    // Keep repeated selection as an explicit diagnostic reload path: it runs
    // through the same navigation, hydration, and profiling stages.
    setActiveThreadId(value, navigationId, undefined, true);
  });

  const preloadThread = useEvent((value: string): (() => void) | undefined => {
    const threadSelection = threadNavigation.current();
    const requestedThreadId = threadSelection.id;
    if (
      !remote.native ||
      remote.threadDetails === null ||
      remote.threadUiStateDatabase === null ||
      value === requestedThreadId
    )
      return;
    const target = parseThreadSelectionKey(value);
    if (target === null) return;
    void remote
      .observeThread(target.connectionId, target.threadId, false)
      .catch((cause: unknown) => {
        console.warn(
          "Could not preload thread observer:",
          cause instanceof Error ? cause.message : "unknown error",
        );
      });
    const uiState = remote.threadUiStateDatabase.get(target.connectionId, target.threadId);
    return remote.threadDetails.preloadWindow({
      connectionId: target.connectionId,
      threadId: target.threadId,
      anchorTurnId: uiState?.historyAnchorTurnId ?? null,
      openGeneration: threadSelection.generation + 1,
    });
  });

  const openSearchThread = useEvent((target: LocatedSearchHit, query: string) => {
    const searchWindow =
      target.hit.kind === "thread"
        ? null
        : new SearchConversationWindow(target, query, remote.searchConversation);
    setActiveThreadId(
      threadSelectionKey({ id: target.hit.threadId, serverId: target.connectionId }),
      undefined,
      target.connectionId,
      true,
      searchWindow,
    );
  });
  return { setActiveThreadId, selectThread, preloadThread, openSearchThread };
}
