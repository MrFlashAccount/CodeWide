import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { ConversationGoalCapabilities } from "../goal/conversationGoalCapabilities";
import { isRejectedContinuation, UnconfirmedContinuationError } from "./continuationFailure";

/** Captured continuation intent; goal activation and empty-input turns are distinct operations. */
export type ComposerContinuation = {
  readonly key: string;
  readonly label: "Resume goal" | "Continue response";
  readonly resume: () => Promise<void>;
};

/** Uses the authoritative tail outcome rather than whichever history page is visible. */
export function selectComposerContinuation({
  acceptsInput,
  captureGoalLifecycle,
  currentGoal,
  currentOutcome,
  onContinueTurn,
  threadLifecycleActive,
}: {
  readonly acceptsInput: boolean;
  readonly captureGoalLifecycle: ConversationGoalCapabilities["captureGoalLifecycle"];
  readonly currentGoal: ThreadGoal | null;
  readonly currentOutcome: ThreadCurrentOutcome | null;
  readonly onContinueTurn: ((sourceTurnId: string) => Promise<void>) | undefined;
  readonly threadLifecycleActive: boolean;
}): ComposerContinuation | null {
  if (!acceptsInput || threadLifecycleActive || currentOutcome?.status === "inProgress") {
    return null;
  }
  if (currentGoal !== null) {
    return selectGoalContinuation(currentGoal, currentOutcome, captureGoalLifecycle);
  }
  if (!isInterrupted(currentOutcome) || onContinueTurn === undefined) {
    return null;
  }
  const sourceTurnId = currentOutcome.turnId;
  return {
    key: `turn:${sourceTurnId}`,
    label: "Continue response",
    resume: async () => onContinueTurn(sourceTurnId),
  };
}

function isInterrupted(outcome: ThreadCurrentOutcome | null): outcome is ThreadCurrentOutcome & {
  readonly status: "interrupted" | "failed";
} {
  return outcome?.status === "interrupted" || outcome?.status === "failed";
}

function selectGoalContinuation(
  goal: ThreadGoal,
  outcome: ThreadCurrentOutcome | null,
  capture: ConversationGoalCapabilities["captureGoalLifecycle"],
): ComposerContinuation | null {
  const resumable = goal.status === "paused" || goal.status === "blocked";
  if (
    capture === undefined ||
    !(resumable || (goal.status === "active" && isInterrupted(outcome)))
  ) {
    return null;
  }
  return {
    key: `goal:${String(goal.createdAt)}:${outcome?.turnId ?? "empty"}`,
    label: "Resume goal",
    resume: async () => {
      const commands = capture();
      try {
        await commands.setStatus("active");
      } catch (error) {
        if (isRejectedContinuation(error)) {
          throw error;
        }
        throw new UnconfirmedContinuationError(error);
      }
    },
  };
}

type ContinuationState =
  | { readonly status: "idle" }
  | { readonly key: string; readonly status: "pending" | "accepted" | "uncertain" };

const continuationStates = new Map<string, ReturnType<typeof createContinuationState>>();

function createContinuationState() {
  return observable<{ operation: ContinuationState }>({ operation: { status: "idle" } });
}

function stateForScope(scope: string): ReturnType<typeof createContinuationState> {
  const previous = continuationStates.get(scope);
  if (previous !== undefined) {
    return previous;
  }
  const state = createContinuationState();
  continuationStates.set(scope, state);
  return state;
}

/** Owns synchronous tap admission and activation-qualified continuation settlement. */
export function useComposerContinuation(
  scope: string,
  owner: ConversationOwner,
  continuation: ComposerContinuation | null,
): { readonly activate: () => void; readonly disabled: boolean } {
  // One interaction owner survives navigation/remounts while an admitted command
  // settles. Goal activation must not be sent twice during delayed turn sync.
  const state = stateForScope(scope);
  const snapshot = useSelector(() => state.get().operation);
  const disabled =
    continuation !== null &&
    (snapshot.status === "pending" ||
      ((snapshot.status === "accepted" || snapshot.status === "uncertain") &&
        snapshot.key === continuation.key));
  const dialog = useAppDialog();
  const activate = useEvent(() => {
    const target = continuation;
    const state$ = state;
    const current = state$.peek().operation;
    if (
      target === null ||
      current.status === "pending" ||
      ((current.status === "accepted" || current.status === "uncertain") &&
        current.key === target.key)
    ) {
      return;
    }
    const activation = owner;
    state$.set({ operation: { key: target.key, status: "pending" } });
    void resumeCaptured(target).then(
      () => state$.set({ operation: { key: target.key, status: "accepted" } }),
      (error: unknown) => {
        state$.set({
          operation:
            error instanceof UnconfirmedContinuationError
              ? { key: target.key, status: "uncertain" }
              : { status: "idle" },
        });
        if (activation.isCurrent()) {
          dialog.alert(
            "Could not continue work",
            error instanceof Error ? error.message : "Continuation failed",
          );
        }
      },
    );
  });
  return { activate, disabled };
}

async function resumeCaptured(target: ComposerContinuation): Promise<void> {
  await target.resume();
}
