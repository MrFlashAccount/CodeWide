import type { Observable } from "@legendapp/state";
import { randomUUID } from "expo-crypto";
import { useState } from "react";

import type { ActionDescriptor, ActionInput } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { classifyForgeError } from "../../../data/forgeErrors";
import type { ThreadId } from "../../../data/reviewContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { DeferReviewChatScenario } from "../pullRequestScreenContract";
import type { PullRequestScreenState } from "../pullRequestScreenModel";
import { startInReviewChat } from "../reviewChatWorkspace";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
  ScenarioKind,
} from "../workspaceCapabilities";
import { scenarioOf } from "./scenarioKind";
import type { ScenarioViews } from "./scenarioRuns";
import { useActionRunner } from "./useActionRunner";

/** The pending-scenario label of "Address in agent" on one review thread. */
const ADDRESS_THREAD_LABEL = "Address comments";

/** Action awaiting its declared input. */
type PendingInput = ActionDescriptor & { readonly input: ActionInput };

/** Intents the PR screen binds to its controls. */
export type PullRequestActions = {
  /** Starts `addressComments` focused on one review thread in the PR's review chat. */
  readonly addressThread: (threadId: ReviewThreadId) => void;
  readonly dismissInput: () => void;
  readonly pendingInput: PendingInput | null;
  readonly run: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly submitInput: (value: boolean | string) => void;
};

function hasInput(action: ActionDescriptor): action is PendingInput {
  return action.input !== null;
}

/**
 * Dispatches a tapped catalog action: agent scenarios start in the PR's canonical
 * review chat and open it through the same route intent as the linked-chat button;
 * a scenario whose run is queued or running opens that run's chat instead of starting
 * another, and a finished one starts again directly. A start is pending (and ignores
 * further taps) until the companion answers. Actions with a declared input collect it
 * first; everything else runs through the confirmation-enforcing runner.
 */
export function usePullRequestActions({
  capabilities,
  model,
  onDeferScenario,
  onOpenThread,
  onRefresh,
  scenarioViews,
  target,
}: {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly model: Observable<PullRequestScreenState>;
  /** Holds a scenario in the review-chat draft until the user confirms its project. */
  readonly onDeferScenario: DeferReviewChatScenario;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onRefresh: () => void;
  /** The Companion's live run state of each scenario action. */
  readonly scenarioViews: ScenarioViews;
  readonly target: PullRequestTarget & { readonly host: string };
}): PullRequestActions {
  const dialog = useAppDialog();
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const runAction = useActionRunner({ capabilities, model, onRefresh, target });
  const start = (
    request: {
      readonly checkId: string | null;
      readonly label: string;
      readonly reviewThreadId: ReviewThreadId | null;
      readonly scenario: ScenarioKind;
    },
    settled: () => void,
  ): void => {
    // The one scenario target: the PR's canonical review chat, resolved by the companion. A
    // start that needs a directory journals nothing, so the confirmed start takes a new key.
    startInReviewChat(
      request.label,
      async (workspace) =>
        capabilities.startScenario(target, {
          checkId: request.checkId,
          idempotencyKey: randomUUID(),
          reviewThreadId: request.reviewThreadId,
          scenario: request.scenario,
          target: { kind: "reviewChat", workspace },
          text: null,
        }),
      onDeferScenario,
    )
      .then(
        (threadId) => {
          // A dismissed draft leaves everything unchanged.
          if (threadId !== null) {
            onOpenThread(threadId);
          }
        },
        (error: unknown) => {
          dialog.error("Could not start the agent", new Error(classifyForgeError(error).message));
        },
      )
      .finally(settled);
  };
  const startScenario = useEvent((action: ActionDescriptor, scenario: ScenarioKind): void => {
    const view = scenarioViews.get(action.actionId);
    if (view?.kind === "active") {
      onOpenThread(view.threadId);
      return;
    }
    // A second tap before the first render of the pending state must not start another run.
    if (model.pending[action.actionId]?.peek() === true) {
      return;
    }
    model.pending[action.actionId]?.set(true);
    start(
      {
        checkId: action.anchor?.kind === "checks" ? action.anchor.checkId : null,
        label: action.label,
        reviewThreadId: null,
        scenario,
      },
      () => {
        model.pending[action.actionId]?.delete();
      },
    );
  });
  const addressThread = useEvent((threadId: ReviewThreadId): void => {
    if (model.addressingThreads[threadId]?.peek() === true) {
      return;
    }
    model.addressingThreads[threadId]?.set(true);
    start(
      {
        checkId: null,
        label: ADDRESS_THREAD_LABEL,
        reviewThreadId: threadId,
        scenario: "addressComments",
      },
      () => {
        model.addressingThreads[threadId]?.delete();
      },
    );
  });
  const run = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    const scenario = scenarioOf(action.kind);
    if (action.availability.state === "disabled") {
      return;
    }
    if (scenario !== null) {
      startScenario(action, scenario);
    } else if (input === null && hasInput(action) && action.kind !== "merge") {
      setPendingInput(action);
    } else {
      runAction(action, input);
    }
  });
  const submitInput = useEvent((value: boolean | string): void => {
    const action = pendingInput;
    setPendingInput(null);
    if (action !== null) {
      runAction(action, value);
    }
  });
  const dismissInput = useEvent((): void => {
    setPendingInput(null);
  });
  return { addressThread, dismissInput, pendingInput, run, submitInput };
}
