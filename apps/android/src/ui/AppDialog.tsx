import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { useEvent } from "../react/useEvent";
import { AppDialogSurface } from "./AppDialogSurface";
import type { AppDialogAction, AppDialogRequest } from "./AppDialog.types";

type AppDialogController = {
  alert(title: string, message?: string, actions?: readonly AppDialogAction[]): void;
};

const AppDialogContext = createContext<AppDialogController | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ isOpen: boolean; request: AppDialogRequest | null }>({ isOpen: false, request: null });
  const alert = useEvent((title: string, message?: string, actions?: readonly AppDialogAction[]) => {
    setState({
      isOpen: true,
      request: {
        title,
        ...(message === undefined ? {} : { message }),
        actions: actions === undefined || actions.length === 0 ? [{ text: "OK" }] : actions,
      },
    });
  });
  const controller = useMemo<AppDialogController>(() => ({ alert }), [alert]);
  const dismiss = useEvent(() => setState((current) => ({ ...current, isOpen: false })));
  const handleAction = useEvent((action: AppDialogAction) => {
    setState((current) => ({ ...current, isOpen: false }));
    action.onPress?.();
  });

  return (
    <AppDialogContext.Provider value={controller}>
      {children}
      <AppDialogSurface isOpen={state.isOpen} request={state.request} onDismiss={dismiss} onAction={handleAction} />
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogController {
  const value = useContext(AppDialogContext);
  if (value === null) throw new Error("useAppDialog must be used inside AppDialogProvider");
  return value;
}
