import { useLocalSearchParams, useRouter } from "expo-router";

import { recoverUnavailableRoute } from "../../../../../src/components/navigation/routeRecovery";
import {
  composerToolRouteSessions,
  type ComposerToolRouteSession,
} from "../../../../../src/services/composer/composerToolRouteSession";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
  v1ThreadRouteParams,
} from "../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../src/services/useRouteSessionLifetime";
import { useEvent } from "../../../../../src/react/useEvent";

type ThreadToolRouteSession =
  | {
      readonly recover: () => void;
      readonly session: ComposerToolRouteSession;
      readonly status: "available";
    }
  | { readonly recover: () => void; readonly status: "unavailable" };

/** Qualifies one retained tool activation against its validated parent thread. */
export function useThreadToolRouteSession(): ThreadToolRouteSession {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const thread = v1ThreadRouteParams(raw);
  const id = routeSessionIdParam(raw.sessionId);
  const session =
    thread.status === "valid" && id.status === "valid"
      ? composerToolRouteSessions.get(id.value.value, threadRouteSessionOwner(thread.value))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (sessionId) => {
      composerToolRouteSessions.close(sessionId);
    },
    (sessionId) =>
      thread.status === "valid"
        ? composerToolRouteSessions.retain(sessionId, threadRouteSessionOwner(thread.value))
        : () => undefined,
  );
  const recover = useEvent((): void => {
    recoverUnavailableRoute(
      router,
      thread.status === "valid" ? v1ThreadDestination(thread.value) : "/v1",
    );
  });
  return session === null
    ? { recover, status: "unavailable" }
    : { recover, session, status: "available" };
}
