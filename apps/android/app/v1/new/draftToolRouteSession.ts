import { useLocalSearchParams, useRouter } from "expo-router";

import { recoverUnavailableRoute } from "../../../src/components/navigation/routeRecovery";
import {
  composerToolRouteSessions,
  type ComposerToolRouteSession,
} from "../../../src/services/composer/composerToolRouteSession";
import { newThreadService } from "../../../src/services/threads/newThreadService";
import {
  draftRouteSessionOwner,
  routeSessionIdParam,
} from "../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../src/services/useRouteSessionLifetime";
import { useEvent } from "../../../src/react/useEvent";

type DraftToolRouteSession =
  | {
      readonly recover: () => void;
      readonly session: ComposerToolRouteSession;
      readonly status: "available";
    }
  | { readonly recover: () => void; readonly status: "unavailable" };

/** Qualifies one retained tool activation against the current unsent draft. */
export function useDraftToolRouteSession(): DraftToolRouteSession {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const id = routeSessionIdParam(sessionId);
  const draft = newThreadService.current();
  const session =
    draft !== null && id.status === "valid"
      ? composerToolRouteSessions.get(id.value.value, draftRouteSessionOwner(draft.id))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (entryId) => {
      composerToolRouteSessions.close(entryId);
    },
    (entryId) =>
      draft === null
        ? () => undefined
        : composerToolRouteSessions.retain(entryId, draftRouteSessionOwner(draft.id)),
  );
  const recover = useEvent((): void => {
    if (session !== null) {
      composerToolRouteSessions.close(session.id);
    }
    recoverUnavailableRoute(router, draft === null ? "/v1" : "/v1/new");
  });
  return session === null
    ? { recover, status: "unavailable" }
    : { recover, session, status: "available" };
}
