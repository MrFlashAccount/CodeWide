import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../src/components/navigation/routeRecovery";
import { ConversationRouteFullscreenOverlay } from "../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { ActivityContentViewer } from "../../../../src/features/conversation/content/ActivityContentViewer";
import { CommandItemOutputViewer } from "../../../../src/features/conversation/content/CommandContentViewer";
import { LargeContentViewerSession } from "../../../../src/features/conversation/content/FullContentViewer";
import { contentRouteSessions } from "../../../../src/services/content/contentRouteSession";
import { newThreadService } from "../../../../src/services/threads/newThreadService";
import {
  draftRouteSessionOwner,
  routeSessionIdParam,
} from "../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../src/services/useRouteSessionLifetime";

/** Restores private large content opened from the current unsent draft. */
export default function V1DraftContentRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const parsed = routeSessionIdParam(sessionId);
  const draft = newThreadService.current();
  const session =
    parsed.status === "valid" && draft !== null
      ? contentRouteSessions.get(parsed.value.value, draftRouteSessionOwner(draft.id))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      contentRouteSessions.close(id);
    },
    (id) =>
      draft === null
        ? () => undefined
        : contentRouteSessions.retain(id, draftRouteSessionOwner(draft.id)),
  );
  if (session === null) {
    return (
      <RouteUnavailable
        message="This content session has expired."
        onBack={() => {
          recoverUnavailableRoute(router, draft === null ? "/" : "/new");
        }}
        title="Content unavailable"
      />
    );
  }
  const close = (): void => {
    contentRouteSessions.close(session.id);
    router.back();
  };
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => {
        if (session.request.kind === "reference") {
          return (
            <LargeContentViewerSession initialRequest={session.request} onClose={closeOverlay} />
          );
        }
        if (session.request.kind === "command") {
          // A draft holds no live thread item; the command reads the output it was opened with.
          return (
            <CommandItemOutputViewer
              current={null}
              onClose={closeOverlay}
              request={session.request}
              resourceKey={`draft:${session.id}:${session.request.itemId}`}
            />
          );
        }
        return (
          <ActivityContentViewer
            onClose={closeOverlay}
            presentation={session.request.presentation}
            text={session.request.text}
            title={session.request.title}
          />
        );
      }}
      scope={`draft-content:${session.id}`}
    />
  );
}
