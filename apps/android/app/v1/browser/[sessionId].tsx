import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../src/components/navigation/RouteUnavailable";
import { ForwardedLoopbackBrowser } from "../../../src/features/ports/ForwardedLoopbackBrowser";
import { browserRouteSessions } from "../../../src/services/browser/browserRouteSession";
import {
  routeSessionIdParam,
  workspaceRouteSessionOwner,
} from "../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../src/services/workspace/workspaceRouteResources";

/** Presents a forwarded browser while WebView history remains inside the browser widget. */
export default function V1BrowserRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const parsed = routeSessionIdParam(sessionId);
  const resources = useWorkspaceRouteResources();
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
        message="This forwarded browser session has expired."
        onBack={() => {
          router.dismissTo("/v1");
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
    <ForwardedLoopbackBrowser
      bottomInset={resources.insets.bottom}
      onClose={close}
      title={session.title}
      topInset={resources.insets.top}
      url={session.url}
    />
  );
}
