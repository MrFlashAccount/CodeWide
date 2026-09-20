import { useLayoutEffect, useRef, type ReactElement } from "react";

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

/** Projects a Router-owned destination into the application fullscreen window. */
export function RouteFullscreenOverlay({
  onDismiss,
  render,
  scope,
}: RouteFullscreenOverlayProps): null {
  const mountedRef = useRef(false);
  const renderRoute = useEvent((close: () => void): ReactElement | null => render(close));
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
