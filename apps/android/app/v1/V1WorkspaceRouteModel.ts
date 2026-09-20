import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";

import {
  routeSessionIdParam,
  v1ThreadRouteParams,
  type V1ThreadDestination,
  type V1ThreadRouteParams,
} from "../../src/services/threads/threadRouteParams";
import type { V1ThreadRouter } from "../../src/services/threads/threadNavigationService";

const THREAD_CONTEXT_ROUTE_PATTERN = /^\/v1\/(?:search$|(?:threads|browser|drawing)\/)/u;
const REPLACEABLE_THREAD_ROUTE_PATTERN = /^\/v1\/(?:threads|browser|drawing)\//u;

/** Identifies routes whose global parameters carry the active V1 thread identity. */
export function isV1ThreadContextPath(pathname: string): boolean {
  return THREAD_CONTEXT_ROUTE_PATTERN.test(pathname);
}

function v1ThreadSelectionMode(pathname: string): "push" | "replace" | "reset" {
  if (pathname === "/v1") {
    return "push";
  }
  return REPLACEABLE_THREAD_ROUTE_PATTERN.test(pathname) ? "replace" : "reset";
}

export type V1WorkspaceRouteModel = {
  readonly currentThread: V1ThreadRouteParams | null;
  readonly globalSearchSessionId: string | null;
  readonly pathname: string;
  readonly router: ReturnType<typeof useRouter>;
  readonly threadRouter: V1ThreadRouter;
};

/** Avoids stacking the draft destination when its server picker is already mounted. */
export function ensureV1NewThreadRoute(
  router: ReturnType<typeof useRouter>,
  pathname: string,
): void {
  if (pathname === "/v1/new") {
    return;
  }
  if (pathname !== "/v1") {
    router.dismissTo("/v1");
  }
  router.push("/v1/new");
}

/** Adapts Expo Router state and commands to the V1 thread-navigation contract. */
export function useV1WorkspaceRouteModel(desktop = false): V1WorkspaceRouteModel {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{
    connectionId?: string | string[];
    globalSearchSessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsedThread = isV1ThreadContextPath(pathname)
    ? v1ThreadRouteParams(routeParams)
    : { status: "invalid" as const };
  const currentThread = parsedThread.status === "valid" ? parsedThread.value : null;
  const parsedSearchSessionId = routeSessionIdParam(routeParams.globalSearchSessionId);
  const globalSearchSessionId =
    parsedSearchSessionId.status === "valid" ? parsedSearchSessionId.value.value : null;
  const searchSelectionMode = desktop ? "reset" : "push";
  const threadRouter: V1ThreadRouter = {
    currentThread,
    dismissToAll() {
      router.dismissTo("/v1");
    },
    push(destination: V1ThreadDestination, searchWindowId?: string) {
      router.push({
        ...destination,
        params: {
          ...destination.params,
          ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    replace(destination: V1ThreadDestination, searchWindowId?: string) {
      router.replace({
        ...destination,
        params: {
          ...destination.params,
          ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    reset(destination: V1ThreadDestination, searchWindowId?: string) {
      router.dismissTo("/v1");
      router.push({
        ...destination,
        params: {
          ...destination.params,
          ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    searchSelectionMode,
    selectionMode: v1ThreadSelectionMode(pathname),
  };
  return {
    currentThread,
    globalSearchSessionId,
    pathname,
    router,
    threadRouter,
  };
}
