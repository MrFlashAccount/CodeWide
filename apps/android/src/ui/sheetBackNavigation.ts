import { createContext, useContext, useEffect, useState } from "react";

import { useEvent } from "../react/useEvent";

export type SheetBackRegistration = (handler: () => void) => () => void;
export const SheetBackContext = createContext<SheetBackRegistration | null>(null);

/** Owns nested Back precedence for one sheet without turning local pages into application routes. */
export function useSheetDismissController(
  close: () => void,
  localBack?: () => void,
): {
  readonly canGoBack: boolean;
  readonly register: SheetBackRegistration;
  readonly requestDismiss: () => void;
} {
  const [handlers, setHandlers] = useState<readonly (() => void)[]>([]);
  const register = useEvent((handler: () => void): (() => void) => {
    setHandlers((current) => [...current, handler]);
    return () => {
      setHandlers((current) => {
        const index = current.lastIndexOf(handler);
        return index < 0 ? current : current.filter((_handler, position) => position !== index);
      });
    };
  });
  const requestDismiss = useEvent((): void => {
    const handler = handlers.at(-1);
    if (handler !== undefined) {
      handler();
      return;
    }
    if (localBack !== undefined) {
      localBack();
      return;
    }
    close();
  });
  return { canGoBack: handlers.length > 0 || localBack !== undefined, register, requestDismiss };
}

/** Gives Android Back to the deepest visible local sheet page before dismissing its sheet. */
export function useSheetBackHandler(enabled: boolean, onBack: () => void): void {
  const register = useContext(SheetBackContext);
  const back = useEvent(onBack);
  useEffect(() => {
    if (!enabled || register === null) {
      return undefined;
    }
    return register(back);
  }, [back, enabled, register]);
}
