import { createContext, type ReactNode, useContext, useState } from "react";

import { useEvent } from "../react/useEvent";
import { AppDialogSurface } from "./AppDialogSurface";
import type { AppDialogAction, AppDialogRequest } from "./AppDialog.types";
import { errorDiagnostic } from "./error-diagnostic";

type AppDialogController = {
  alert: (title: string, message?: string, actions?: readonly AppDialogAction[]) => void;
  error: (title: string, cause: unknown, actions?: readonly AppDialogAction[]) => void;
};

const AppDialogContext = createContext<AppDialogController | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ isOpen: boolean; request: AppDialogRequest | null }>({
    isOpen: false,
    request: null,
  });
  const alert = useEvent(
    (title: string, message?: string, actions?: readonly AppDialogAction[]) => {
      setState({
        isOpen: true,
        request: {
          title,
          ...(message === undefined ? {} : { message }),
          actions: actions === undefined || actions.length === 0 ? [{ text: "OK" }] : actions,
        },
      });
    },
  );
  const error = useEvent((title: string, cause: unknown, actions?: readonly AppDialogAction[]) => {
    setState({
      isOpen: true,
      request: {
        actions: actions === undefined || actions.length === 0 ? [{ text: "OK" }] : actions,
        diagnostic: errorDiagnostic(title, cause),
        message:
          cause instanceof Error
            ? cause.message
            : typeof cause === "string"
              ? cause
              : "The operation failed",
        title,
      },
    });
  });
  const controller: AppDialogController = { alert, error };
  const dismiss = useEvent(() => {
    setState((current) => ({ ...current, isOpen: false }));
  });
  const handleAction = useEvent((action: AppDialogAction) => {
    setState((current) => ({ ...current, isOpen: false }));
    action.onPress?.();
  });

  return (
    <AppDialogContext.Provider value={controller}>
      {children}
      {state.isOpen && (
        <AppDialogSurface
          isOpen
          onAction={handleAction}
          onDismiss={dismiss}
          request={state.request}
        />
      )}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogController {
  const value = useContext(AppDialogContext);
  if (value === null) {
    throw new Error("useAppDialog must be used inside AppDialogProvider");
  }
  return value;
}
