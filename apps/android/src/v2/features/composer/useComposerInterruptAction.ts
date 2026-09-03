import { useRef, useState, useTransition } from "react";

import { useEvent } from "../../../react/useEvent";
import { actionFailure } from "../../presentation/actions/actionFailure";

interface InterruptRequest {
  interrupt(turnId: string): Promise<void>;
  turnId: string;
}

interface ComposerInterruptActionInput {
  activeTurnId: string | null | undefined;
  enabled: boolean;
  onInterrupt: ((turnId: string) => Promise<void>) | undefined;
}

export interface ComposerInterruptAction {
  activate(): void;
  clearFailure(): void;
  error: string | null;
  pending: boolean;
  retry(): void;
}

/** Owns one primary-composer interruption activation without changing the thread projection. */
export function useComposerInterruptAction(
  input: ComposerInterruptActionInput,
): ComposerInterruptAction {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const retryRequest = useRef<InterruptRequest | null>(null);
  const run = useEvent((request: InterruptRequest): void => {
    if (running.current) return;
    running.current = true;
    retryRequest.current = request;
    setError(null);
    startTransition(() =>
      request
        .interrupt(request.turnId)
        .catch((cause: unknown) => {
          setError(actionFailure(cause, "Could not stop response"));
        })
        .finally(() => {
          running.current = false;
        }),
    );
  });
  const activate = useEvent((): void => {
    if (
      !input.enabled ||
      input.activeTurnId === null ||
      input.activeTurnId === undefined ||
      input.onInterrupt === undefined
    )
      return;
    run({ interrupt: input.onInterrupt, turnId: input.activeTurnId });
  });
  const retry = useEvent((): void => {
    const request = retryRequest.current;
    if (request !== null) run(request);
  });
  const clearFailure = useEvent((): void => {
    retryRequest.current = null;
    setError(null);
  });
  return { activate, clearFailure, error, pending, retry };
}
