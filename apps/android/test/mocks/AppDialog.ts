interface MockDialogAction {
  onPress?: () => void;
  text: string;
}

interface MockDialogRequest {
  actions: readonly MockDialogAction[];
  message?: string;
  title: string;
}

let lastRequest: MockDialogRequest | null = null;

export function AppDialogProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}

type MockDialogAlert = (
  title: string,
  message?: string,
  actions?: readonly MockDialogAction[],
) => void;

type MockDialogController = MockDialogAlert & {
  alert: MockDialogAlert;
  error: (title: string, cause: unknown, actions?: readonly MockDialogAction[]) => void;
};

export function useAppDialog(): MockDialogController {
  const alert: MockDialogAlert = (title, message, actions = [{ text: "OK" }]) => {
    lastRequest = { actions, ...(message === undefined ? {} : { message }), title };
  };
  return Object.assign(alert, {
    alert,
    error: (title: string, cause: unknown, actions?: readonly MockDialogAction[]) => {
      alert(
        title,
        cause instanceof Error ? cause.message : typeof cause === "string" ? cause : undefined,
        actions,
      );
    },
  });
}

export function getAppDialogRequest(): MockDialogRequest | null {
  return lastRequest;
}

export function invokeAppDialogAction(text: string): void {
  const action = lastRequest?.actions.find((candidate) => candidate.text === text);
  if (action === undefined) {
    throw new Error(`Dialog action not found: ${text}`);
  }
  action.onPress?.();
}

export function resetAppDialog(): void {
  lastRequest = null;
}
import type { ReactNode } from "react";
