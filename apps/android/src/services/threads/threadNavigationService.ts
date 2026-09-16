import { KeyboardController } from "react-native-keyboard-controller";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
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
  readonly native: boolean;
  readonly observeThread: (
    connectionId: string,
    threadId: string,
    active?: boolean,
  ) => Promise<void>;
  readonly searchConversation: (
    connectionId: string,
    query: SearchContextQuery,
  ) => Promise<SearchConversationPage>;
  readonly threadDetails: ThreadDetailDatabase | null;
  readonly threadUiStateDatabase: ThreadUiStateDatabase | null;
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
  readonly selectionMode: "push" | "replace";
};

/** Qualified thread navigation commands consumed by the mounted workspace. */
export type ThreadNavigationService = {
  readonly closeActiveThread: () => void;
  readonly openSearchThread: (target: LocatedSearchHit, query: string) => void;
  readonly preloadThread: (selectionKey: string) => (() => void) | undefined;
  readonly selectThread: (selectionKey: string | null) => void;
};

const generations = new Map<string, number>();

type OpenThreadInput = {
  readonly mode: "push" | "replace";
  readonly navigationId?: string;
  readonly params: V1ThreadRouteParams;
  readonly searchWindowId?: string;
};

function routeKey(params: V1ThreadRouteParams): string {
  return threadSelectionKey({
    id: params.threadId.value,
    serverId: params.connectionId.value,
  });
}

function nextGeneration(params: V1ThreadRouteParams): number {
  const key = routeKey(params);
  const next = (generations.get(key) ?? 0) + 1;
  generations.set(key, next);
  return next;
}

/** Returns the current explicit open/reload generation for a qualified thread route. */
export function threadRouteGeneration(params: V1ThreadRouteParams): number {
  return generations.get(routeKey(params)) ?? 0;
}

/** Preserves V1 observer, presentation, IME, preload, and timing order around Router commands. */
export function useThreadNavigationService(
  remote: ThreadNavigationReadCapability,
  router: V1ThreadRouter,
  setActiveConnection: (connectionId: string) => void,
): ThreadNavigationService {
  const open = useEvent(({ mode, navigationId, params, searchWindowId }: OpenThreadInput): void => {
    const current = router.currentThread;
    const changed =
      current === null ||
      current.connectionId.value !== params.connectionId.value ||
      current.threadId.value !== params.threadId.value;
    // Observer attachment is background work and this handler consumes every rejection.
    void remote
      .observeThread(params.connectionId.value, params.threadId.value)
      .catch((error: unknown) => {
        // WHY: V1 observer failures remain a bounded development warning during route migration.
        // oxlint-disable-next-line eslint/no-console
        console.warn(
          "Could not attach thread observer:",
          error instanceof Error ? error.message : "unknown error",
        );
      });
    if (changed) {
      void KeyboardController.dismiss({ animated: false, keepFocus: false }).catch(() => undefined);
      remote.threadDetails?.chat.beginPresentation(
        params.connectionId.value,
        params.threadId.value,
      );
    }
    const startedAt = performance.now();
    nextGeneration(params);
    setActiveConnection(params.connectionId.value);
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
        // WHY: This development-only timing probe preserves the existing navigation trace.
        // oxlint-disable-next-line eslint/no-console
        console.log(
          `[CodeWide perf] thread_selection_next_frame_ms=${String(Math.round(elapsed))}`,
        );
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
    // Frame tracing is telemetry-only work and does not control route admission.
    void beginNavigationFrameTrace(navigationId).catch(() => undefined);
    const current = router.currentThread;
    const same =
      current !== null &&
      current.connectionId.value === params.connectionId.value &&
      current.threadId.value === params.threadId.value;
    open({
      mode: same ? "replace" : router.selectionMode,
      navigationId,
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
      mode: router.selectionMode,
      params,
      ...(searchWindowId === null ? {} : { searchWindowId }),
    });
  });

  const preloadThread = useEvent((selectionKey: string): (() => void) | undefined => {
    const params = parseThreadSelectionKey(selectionKey);
    if (params === null || !canPreloadThread(remote, router.currentThread, params)) {
      return undefined;
    }
    // Observer preloading is background work and this handler consumes every rejection.
    void remote
      .observeThread(params.connectionId.value, params.threadId.value, false)
      .catch((error: unknown) => {
        // WHY: V1 preload failures remain a bounded development warning during route migration.
        // oxlint-disable-next-line eslint/no-console
        console.warn(
          "Could not preload thread observer:",
          error instanceof Error ? error.message : "unknown error",
        );
      });
    const uiState = remote.threadUiStateDatabase.get(
      params.connectionId.value,
      params.threadId.value,
    );
    return remote.threadDetails.preloadWindow({
      anchorTurnId: uiState?.historyAnchorTurnId ?? null,
      connectionId: params.connectionId.value,
      openGeneration: threadRouteGeneration(params) + 1,
      threadId: params.threadId.value,
    });
  });

  const closeActiveThread = useEvent((): void => {
    router.dismissToAll();
  });
  return { closeActiveThread, openSearchThread, preloadThread, selectThread };
}

function canPreloadThread(
  remote: ThreadNavigationReadCapability,
  current: V1ThreadRouteParams | null,
  params: V1ThreadRouteParams,
): remote is ThreadNavigationReadCapability & {
  readonly threadDetails: ThreadDetailDatabase;
  readonly threadUiStateDatabase: ThreadUiStateDatabase;
} {
  if (!remote.native || remote.threadDetails === null || remote.threadUiStateDatabase === null) {
    return false;
  }
  return !(
    current?.connectionId.value === params.connectionId.value &&
    current.threadId.value === params.threadId.value
  );
}
