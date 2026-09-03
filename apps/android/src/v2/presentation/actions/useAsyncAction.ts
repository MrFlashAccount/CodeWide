import { useRef, useState, useTransition } from "react";

import { useEvent } from "../../../react/useEvent";
import { actionFailure } from "./actionFailure";

type AsyncAction = () => void | Promise<void>;

interface AsyncActionRequest {
  action: AsyncAction;
  failure: string;
  pending: string;
}

export interface AsyncActionState {
  error: string | null;
  pending: boolean;
  pendingLabel: string;
  retry(): void;
  run(request: AsyncActionRequest): void;
}

/** Owns one leaf action's pending, duplicate suppression, failure, and exact retry lifecycle. */
export function useAsyncAction(): AsyncActionState {
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState("Working…");
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const lastRequest = useRef<AsyncActionRequest | null>(null);
  const run = useEvent((request: AsyncActionRequest): void => {
    if (running.current) return;
    running.current = true;
    lastRequest.current = request;
    setError(null);
    setPendingLabel(request.pending);
    startTransition(async () => {
      try {
        await request.action();
      } catch (cause) {
        setError(actionFailure(cause, request.failure));
      }
      running.current = false;
    });
  });
  const retry = useEvent((): void => {
    const request = lastRequest.current;
    if (request !== null) run(request);
  });
  return { error, pending, pendingLabel, retry, run };
}
