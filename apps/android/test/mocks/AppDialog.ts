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

export function useAppDialog(): (
  title: string,
  message?: string,
  actions?: readonly MockDialogAction[],
) => void {
  return (title, message, actions = [{ text: "OK" }]) => {
    lastRequest = { actions, ...(message === undefined ? {} : { message }), title };
  };
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
