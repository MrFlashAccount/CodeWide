import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../src/components/navigation/RouteUnavailable";
import { useLayoutEffect } from "react";
import { useEvent } from "../../../src/react/useEvent";
import { browserPresentation } from "../../../src/services/browser/browserPresentation";
import { browserRouteSessions } from "../../../src/services/browser/browserRouteSession";
import {
  routeSessionIdParam,
  workspaceRouteSessionOwner,
} from "../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../src/services/useRouteSessionLifetime";

/** Presents a standalone browser while WebView history remains inside the browser feature. */
export default function V1BrowserRoute(): React.JSX.Element | null {
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
  const close = useEvent((): void => {
    if (session === null) {
      return;
    }
    browserPresentation.hide(session.id);
    browserRouteSessions.close(session.id);
    router.back();
  });
  useLayoutEffect(() => {
    if (session === null) {
      return undefined;
    }
    browserPresentation.show({
      initialView: session.initialView,
      onDismiss: close,
      sessionId: session.id,
      tabs: session.tabs,
      thread: session.thread,
    });
    return () => {
      browserPresentation.hide(session.id);
    };
  }, [close, session]);
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
  return null;
}
