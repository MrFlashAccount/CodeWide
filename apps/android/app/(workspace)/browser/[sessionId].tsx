import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../src/components/navigation/RouteUnavailable";
import { RouteFullscreenOverlay } from "../../../src/components/navigation/RouteFullscreenOverlay";
import { BrowserWorkspace } from "../../../src/features/browser/BrowserWorkspace";
import { browserRouteSessions } from "../../../src/services/browser/browserRouteSession";
import {
  routeSessionIdParam,
  workspaceRouteSessionOwner,
} from "../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../src/services/useRouteSessionLifetime";

/** Presents a standalone browser while WebView history remains inside the browser feature. */
export default function V1BrowserRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const parsed = routeSessionIdParam(sessionId);
  const session =
    parsed.status === "valid"
      ? browserRouteSessions.get(parsed.value.value, workspaceRouteSessionOwner)
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      browserRouteSessions.close(id);
    },
    (id) => browserRouteSessions.retain(id, workspaceRouteSessionOwner),
  );
  if (session === null) {
    return (
      <RouteUnavailable
        message="This browser session has expired."
        onBack={() => {
          router.dismissTo("/");
        }}
        title="Browser unavailable"
      />
    );
  }
  const close = (): void => {
    browserRouteSessions.close(session.id);
    router.back();
  };
  return (
    <RouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => (
        <BrowserWorkspace
          onClose={closeOverlay}
          title={session.title}
          url={session.url}
          {...(session.headers === undefined ? {} : { headers: session.headers })}
        />
      )}
      scope={`browser:${session.id}`}
    />
  );
}
