import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../../src/components/navigation/RouteUnavailable";
import { TurnChangesRoute } from "../../../../../../../src/features/changes/RouteChangesWorkspace";
import { changesRouteSessions } from "../../../../../../../src/services/changes/changesRouteSession";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  turnIdParam,
  v1ThreadRouteParams,
} from "../../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../../src/services/useRouteSessionLifetime";

type TurnChangesRequest = Extract<
  NonNullable<ReturnType<typeof changesRouteSessions.get>>["request"],
  { readonly kind: "turn" }
>;

type ResolvedTurnChangesSession = {
  readonly id: string;
  readonly owner: ReturnType<typeof threadRouteSessionOwner>;
  readonly request: TurnChangesRequest;
};

function resolveTurnChangesSession(raw: {
  readonly connectionId?: string | readonly string[];
  readonly sessionId?: string | readonly string[];
  readonly threadId?: string | readonly string[];
  readonly turnId?: string | readonly string[];
}): ResolvedTurnChangesSession | null {
  const parsedSession = routeSessionIdParam(raw.sessionId);
  const parsedTurn = turnIdParam(raw.turnId);
  const thread = v1ThreadRouteParams(raw);
  if (
    parsedSession.status === "invalid" ||
    parsedTurn.status === "invalid" ||
    thread.status === "invalid"
  ) {
    return null;
  }
  const owner = threadRouteSessionOwner(thread.value);
  const session = changesRouteSessions.get(parsedSession.value.value, owner);
  if (
    session?.request.kind !== "turn" ||
    session.request.target.turnId !== parsedTurn.value.value
  ) {
    return null;
  }
  return { id: session.id, owner, request: session.request };
}

/** Presents the immutable change scope for one validated turn route. */
export default function V1TurnChangesRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
    turnId?: string | string[];
  }>();
  const session = resolveTurnChangesSession(raw);
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      changesRouteSessions.close(id);
    },
    (id) => (session === null ? () => undefined : changesRouteSessions.retain(id, session.owner)),
  );
  if (session === null) {
    return (
      <RouteUnavailable
        message="This turn changes session has expired."
        onBack={router.back}
        title="Turn changes unavailable"
      />
    );
  }
  const close = (): void => {
    changesRouteSessions.close(session.id);
    router.back();
  };
  // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
  // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
  return <TurnChangesRoute onClose={close} request={session.request} />;
}
