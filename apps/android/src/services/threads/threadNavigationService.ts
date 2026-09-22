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
  type V1ThreadDestination,
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

/** Declarative destination shared by list links and non-visual thread selection. */
export type ThreadLink = {
  readonly dismissTo: boolean;
  readonly href: V1ThreadDestination;
};

/** List navigation prepares observation independently from the Link-owned transition. */
export type ThreadListNavigation = {
  readonly getThreadLink: (thread: {
    readonly id: string;
    readonly serverId: string;
  }) => ThreadLink;
  readonly prepareThreadLink: (selectionKey: string) => void;
};

export type V1ThreadRouter = {
  readonly currentThread: V1ThreadRouteParams | null;
  readonly dismissTo: (destination: V1ThreadDestination) => void;
  readonly dismissToAll: () => void;
  readonly link: (destination: V1ThreadDestination) => ThreadLink;
  readonly navigate: (destination: V1ThreadDestination) => void;
  readonly push: (destination: V1ThreadDestination, searchWindowId?: string) => void;
  readonly replace: (destination: V1ThreadDestination, searchWindowId?: string) => void;
  readonly searchSelectionMode: "push" | "replace";
};

/** Qualified thread navigation commands consumed by the mounted workspace. */
export type ThreadNavigationService = ThreadListNavigation & {
  readonly closeActiveThread: () => void;
  readonly openSearchThread: (target: LocatedSearchHit, query: string) => void;
  readonly selectThread: (selectionKey: string | null) => void;
};

/** Preserves V1 observer, IME, and timing order around Router commands. */
export function useThreadNavigationService(
  remote: ThreadNavigationReadCapability,
  router: V1ThreadRouter,
): ThreadNavigationService {
  const prepare = useEvent((params: V1ThreadRouteParams): void => {
    const current = router.currentThread;
    const changed =
      current === null ||
      current.connectionId.value !== params.connectionId.value ||
      current.threadId.value !== params.threadId.value;
    if (!changed) {
      return;
    }
    const navigationId = beginThreadNavigation(params.connectionId.value, params.threadId.value);
    if (navigationId !== null) {
      void beginNavigationFrameTrace(navigationId).catch(() => undefined);
    }
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
    void KeyboardController.dismiss({ animated: false, keepFocus: false }).catch(() => undefined);
    const startedAt = performance.now();
    requestAnimationFrame(() => {
      const elapsed = performance.now() - startedAt;
      recordTiming("thread_selection_next_frame_ms", elapsed);
      if (navigationId !== null) {
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
    prepare(params);
    const link = router.link(v1ThreadDestination(params));
    if (link.dismissTo) {
      router.dismissTo(link.href);
    } else {
      router.navigate(link.href);
    }
  });

  // Render callback: link props must use this render's route, before layout effects publish handlers.
  const getThreadLink = (thread: { readonly id: string; readonly serverId: string }): ThreadLink =>
    router.link({
      params: { connectionId: thread.serverId, threadId: thread.id },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  const prepareThreadLink = useEvent((selectionKey: string): void => {
    const params = parseThreadSelectionKey(selectionKey);
    if (params !== null) {
      prepare(params);
    }
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
    prepare(params);
    router[router.searchSelectionMode](v1ThreadDestination(params), searchWindowId ?? undefined);
  });

  const closeActiveThread = useEvent((): void => {
    router.dismissToAll();
  });
  return { closeActiveThread, getThreadLink, openSearchThread, prepareThreadLink, selectThread };
}
