import { KeyboardController } from "react-native-keyboard-controller";
import { appLogger } from "../../observability/logger";
import { recordTiming } from "../../data/operational-metrics";
import {
  beginThreadNavigation,
  markThreadNavigationStage,
} from "../../data/thread-navigation-metrics";
import { beginNavigationFrameTrace } from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";
import type { SearchContextQuery, SearchConversationPage } from "../../data/message-search";
import type { LocatedSearchHit } from "../../features/search/GlobalSearchScreen";
import { searchRouteSessions } from "../search/searchRouteSession";
import {
  parseThreadSelectionKey,
  threadSelectionKey,
  threadRouteSessionOwner,
  v1ThreadDestination,
  type V1ThreadRouteParams,
} from "./threadRouteParams";

export type ThreadNavigationReadCapability = {
  readonly observeThread: (
    connectionId: string,
    threadId: string,
    active?: boolean,
  ) => Promise<void>;
  readonly searchConversation: (
    connectionId: string,
    query: SearchContextQuery,
  ) => Promise<SearchConversationPage>;
};

export type V1ThreadRouter = {
  readonly currentThread: V1ThreadRouteParams | null;
  readonly dismissToAll: () => void;
  readonly push: (
    destination: ReturnType<typeof v1ThreadDestination>,
    searchWindowId?: string,
  ) => void;
  readonly replace: (
    destination: ReturnType<typeof v1ThreadDestination>,
    searchWindowId?: string,
  ) => void;
  readonly reset: (
    destination: ReturnType<typeof v1ThreadDestination>,
    searchWindowId?: string,
  ) => void;
  readonly searchSelectionMode: "push" | "reset";
  readonly selectionMode: "push" | "replace" | "reset";
};

/** Qualified thread navigation commands consumed by the mounted workspace. */
export type ThreadNavigationService = {
  readonly closeActiveThread: () => void;
  readonly openSearchThread: (target: LocatedSearchHit, query: string) => void;
  readonly selectThread: (selectionKey: string | null) => void;
};

type OpenThreadInput = {
  readonly mode: "push" | "replace" | "reset";
  readonly navigationId?: string;
  readonly params: V1ThreadRouteParams;
  readonly searchWindowId?: string;
};

function isCurrentThread(
  current: V1ThreadRouteParams | null,
  params: V1ThreadRouteParams,
): boolean {
  return (
    current?.connectionId.value === params.connectionId.value &&
    current.threadId.value === params.threadId.value
  );
}

/** Preserves V1 observer, IME, and timing order around Router commands. */
export function useThreadNavigationService(
  remote: ThreadNavigationReadCapability,
  router: V1ThreadRouter,
): ThreadNavigationService {
  const open = useEvent(({ mode, navigationId, params, searchWindowId }: OpenThreadInput): void => {
    const current = router.currentThread;
    const changed =
      current === null ||
      current.connectionId.value !== params.connectionId.value ||
      current.threadId.value !== params.threadId.value;
    // Observer attachment is background work and this handler consumes every rejection.
    void remote.observeThread(params.connectionId.value, params.threadId.value).catch(() => {
      appLogger.warn({
        event: "thread.observer.attach_failed",
        fields: {
          connectionId: params.connectionId.value,
          threadId: params.threadId.value,
        },
      });
    });
    if (changed) {
      void KeyboardController.dismiss({ animated: false, keepFocus: false }).catch(() => undefined);
    }
    const startedAt = performance.now();
    router[mode](v1ThreadDestination(params), searchWindowId);
    requestAnimationFrame(() => {
      const elapsed = performance.now() - startedAt;
      recordTiming("thread_selection_next_frame_ms", elapsed);
      if (navigationId !== undefined) {
        markThreadNavigationStage(
          params.connectionId.value,
          params.threadId.value,
          "selection_next_frame",
          { values: { animationFrameDelayMs: elapsed } },
          navigationId,
        );
      }
      if (__DEV__) {
        appLogger.info({
          event: "thread.selection_next_frame",
          fields: { durationMs: Math.round(elapsed) },
        });
      }
    });
  });

  const selectThread = useEvent((selectionKey: string | null): void => {
    if (selectionKey === null) {
      router.dismissToAll();
      return;
    }
    const params = parseThreadSelectionKey(selectionKey);
    if (params === null) {
      return;
    }
    const navigationId = beginThreadNavigation(params.connectionId.value, params.threadId.value);
    if (navigationId !== null) {
      // Frame tracing is explicitly armed diagnostic work and does not control route admission.
      void beginNavigationFrameTrace(navigationId).catch(() => undefined);
    }
    open({
      mode: isCurrentThread(router.currentThread, params) ? "replace" : router.selectionMode,
      ...(navigationId === null ? {} : { navigationId }),
      params,
    });
  });

  const openSearchThread = useEvent((target: LocatedSearchHit, query: string): void => {
    const selection = threadSelectionKey({
      id: target.hit.threadId,
      serverId: target.connectionId,
    });
    const params = parseThreadSelectionKey(selection);
    if (params === null) {
      return;
    }
    const searchWindowId = searchRouteSessions.openWindow({
      owner: threadRouteSessionOwner(params),
      query,
      searchConversation: remote.searchConversation,
      target,
    });
    open({
      mode: router.searchSelectionMode,
      params,
      ...(searchWindowId === null ? {} : { searchWindowId }),
    });
  });

  const closeActiveThread = useEvent((): void => {
    router.dismissToAll();
  });
  return { closeActiveThread, openSearchThread, selectThread };
}
