import { createContext, useContext, useEffect, useRef } from "react";

import { useEvent } from "../react/useEvent";

export type SheetBackRegistration = (handler: () => void) => () => void;
export const SheetBackContext = createContext<SheetBackRegistration | null>(null);

/** Owns nested Back precedence for one sheet without turning local pages into application routes. */
export function useSheetDismissController(
  close: () => void,
  localBack?: () => void,
): {
  readonly register: SheetBackRegistration;
  readonly requestDismiss: () => void;
} {
  const handlersRef = useRef<(() => void)[]>([]);
  const register = useEvent((handler: () => void): (() => void) => {
    handlersRef.current.push(handler);
    return () => {
      const index = handlersRef.current.lastIndexOf(handler);
      if (index >= 0) {
        handlersRef.current.splice(index, 1);
      }
    };
  });
  const requestDismiss = useEvent((): void => {
    const handler = handlersRef.current.at(-1);
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
  return { register, requestDismiss };
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
