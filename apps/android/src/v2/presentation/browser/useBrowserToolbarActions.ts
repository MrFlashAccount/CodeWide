import { useEvent } from "../../../react/useEvent";
import { useAsyncAction, type AsyncActionState } from "../actions/useAsyncAction";

interface UseBrowserToolbarActionsInput {
  onClose(): void | Promise<void>;
  openDevTools(): Promise<void>;
  toggleTrace(): Promise<void>;
  traceRunning: boolean;
}

interface BrowserToolbarActions {
  close(): void;
  closeAction: AsyncActionState;
  devToolsAction: AsyncActionState;
  inspect(): void;
  trace(): void;
  traceAction: AsyncActionState;
}

/** Owns independent async lifecycles for the browser toolbar's three Promise actions. */
export function useBrowserToolbarActions(
  input: UseBrowserToolbarActionsInput,
): BrowserToolbarActions {
  const closeAction = useAsyncAction();
  const devToolsAction = useAsyncAction();
  const traceAction = useAsyncAction();
  const close = useEvent(() => {
    closeAction.run({
      action: input.onClose,
      failure: "Could not close browser.",
      pending: "Closing browser…",
    });
  });
  const inspect = useEvent(() => {
    devToolsAction.run({
      action: input.openDevTools,
      failure: "Could not open Chromium DevTools.",
      pending: "Opening Chromium DevTools…",
    });
  });
  const trace = useEvent(() => {
    traceAction.run({
      action: input.toggleTrace,
      failure: "Could not change browser trace.",
      pending: input.traceRunning ? "Stopping browser trace…" : "Starting browser trace…",
    });
  });
  return { close, closeAction, devToolsAction, inspect, trace, traceAction };
}
