import { QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useLayoutEffect, useRef, type ReactElement } from "react";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import {
  useAppFullscreenOverlay,
  type AppFullscreenOverlayLifecycle,
} from "../../ui/AppFullscreenOverlay";

type RouteFullscreenOverlayProps = {
  readonly onDismiss: () => void;
  readonly render: (close: () => void) => ReactElement | null;
  readonly scope: string;
};

/** Projects a route into the application window with its existing query client. */
export function RouteFullscreenOverlay({
  onDismiss,
  render,
  scope,
}: RouteFullscreenOverlayProps): null {
  const mountedRef = useRef(false);
  // The host is outside the workspace provider. Preserve this route's client,
  // without creating another cache or requiring queries in a query-free route.
  const queryClient = useContext(QueryClientContext);
  const renderRoute = useEvent((close: () => void): ReactElement | null => {
    const content = render(close);
    return queryClient === undefined ? (
      content
    ) : (
      <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
    );
  });
  const dismissRoute = useEvent(() => {
    if (mountedRef.current) {
      onDismiss();
    }
  });
  const lifecycle = useConstant<AppFullscreenOverlayLifecycle>(() => ({
    didClose: dismissRoute,
  }));
  const { present } = useAppFullscreenOverlay({ lifecycle, scope });

  useLayoutEffect(() => {
    mountedRef.current = true;
    const handle = present(({ close }) => renderRoute(close), {
      dismissOnScopeUnmount: false,
    });
    return () => {
      mountedRef.current = false;
      handle.close();
    };
  }, [present, renderRoute, scope]);

  return null;
}
