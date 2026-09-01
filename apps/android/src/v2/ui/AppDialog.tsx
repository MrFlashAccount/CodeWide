import { createContext, type PropsWithChildren, useContext, useState } from "react";

import { useEvent } from "../../react/useEvent";
import { AppDialogSurface } from "./AppDialogSurface";
import type { AppDialogAction, AppDialogRequest } from "./AppDialog.types";

type AppDialogAlert = (
  title: string,
  message?: string,
  actions?: readonly AppDialogAction[],
) => void;

interface AppDialogState {
  isOpen: boolean;
  request: AppDialogRequest | null;
}

const AppDialogContext = createContext<AppDialogAlert | null>(null);

export function AppDialogProvider(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  const [state, setState] = useState<AppDialogState>({ isOpen: false, request: null });
  const alert = useEvent(
    (title: string, message?: string, actions?: readonly AppDialogAction[]): void => {
      setState({
        isOpen: true,
        request: {
          actions: actions === undefined || actions.length === 0 ? [{ text: "OK" }] : actions,
          ...(message === undefined ? {} : { message }),
          title,
        },
      });
    },
  );
  const dismiss = useEvent(() => setState((current) => ({ ...current, isOpen: false })));
  const handleAction = useEvent((action: AppDialogAction) => {
    setState((current) => ({ ...current, isOpen: false }));
    action.onPress?.();
  });

  return (
    <AppDialogContext.Provider value={alert}>
      {children}
      <AppDialogSurface
        isOpen={state.isOpen}
        onAction={handleAction}
        onDismiss={dismiss}
        request={state.request}
      />
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogAlert {
  const value = useContext(AppDialogContext);
  if (value === null) throw new Error("useAppDialog must be used inside AppDialogProvider");
  return value;
}
