import { useLocalSearchParams, usePathname, useRouter } from "expo-router";

import {
  v1ThreadRouteParams,
  type V1ThreadDestination,
  type V1ThreadRouteParams,
} from "../../src/services/threads/threadRouteParams";
import type { V1ThreadRouter } from "../../src/services/threads/threadNavigationService";

export type V1WorkspaceRouteModel = {
  readonly currentThread: V1ThreadRouteParams | null;
  readonly pathname: string;
  readonly router: ReturnType<typeof useRouter>;
  readonly threadRouter: V1ThreadRouter;
};

/** Avoids stacking the draft destination when its server picker is already mounted. */
export function ensureV1NewThreadRoute(
  router: ReturnType<typeof useRouter>,
  pathname: string,
): void {
  if (pathname !== "/v1/new") {
    router.push("/v1/new");
  }
}

/** Adapts Expo Router state and commands to the V1 thread-navigation contract. */
export function useV1WorkspaceRouteModel(): V1WorkspaceRouteModel {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useLocalSearchParams<{
    connectionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsedThread = pathname.startsWith("/v1/threads/")
    ? v1ThreadRouteParams(routeParams)
    : { status: "invalid" as const };
  const currentThread = parsedThread.status === "valid" ? parsedThread.value : null;
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
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    replace(destination: V1ThreadDestination, searchWindowId?: string) {
      router.replace({
        ...destination,
        params: {
          ...destination.params,
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    selectionMode: pathname === "/v1" ? "push" : "replace",
  };
  return { currentThread, pathname, router, threadRouter };
}
