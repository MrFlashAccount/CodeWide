import type { Observable } from "@legendapp/state";
import { randomUUID } from "expo-crypto";
import { useState } from "react";

import type { ActionDescriptor, ActionInput } from "../../../data/forgeActionCatalog";
import { classifyForgeError } from "../../../data/forgeErrors";
import type { LinkedThread } from "../../../data/forgePullRequestContract";
import type { ThreadId } from "../../../data/reviewContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { PullRequestScreenState } from "../pullRequestScreenModel";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
  ScenarioKind,
  ScenarioTarget,
} from "../workspaceCapabilities";
import { defaultScenarioTarget, scenarioOf } from "./scenarioTarget";
import { useActionRunner } from "./useActionRunner";

/** Action awaiting its declared input. */
type PendingInput = ActionDescriptor & { readonly input: ActionInput };

/** One agent scenario request; `pendingId` shimmers the control that started it. */
type ScenarioRequest = {
  readonly checkId: string | null;
  /** Called when a target is chosen and the request leaves; nothing is sent before it. */
  readonly onBegin?: () => void;
  /** Called once the companion answered: `true` when the agent turn was accepted. */
  readonly onSettled?: (accepted: boolean) => void;
  readonly pendingId: string | null;
  readonly scenario: ScenarioKind;
  /** Where the request goes; `null` applies the default rule and asks when it is ambiguous. */
  readonly target: ScenarioTarget | null;
  readonly text: string | null;
};

/** Intents the PR screen binds to its controls. */
export type PullRequestActions = {
  readonly dismissInput: () => void;
  readonly pendingInput: PendingInput | null;
  readonly run: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly startScenario: (request: ScenarioRequest) => void;
  readonly submitInput: (value: boolean | string) => void;
};

function hasInput(action: ActionDescriptor): action is PendingInput {
  return action.input !== null;
}

/**
 * Dispatches a tapped catalog action: agent scenarios start in the linked or a
 * new thread and open it; actions with a declared input collect it first;
 * everything else runs through the confirmation-enforcing runner.
 */
export function usePullRequestActions({
  capabilities,
  describeThread,
  links,
  model,
  onOpenThread,
  onRefresh,
  target,
}: {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly describeThread: (threadId: ThreadId) => { readonly title: string } | null;
  readonly links: readonly LinkedThread[];
  readonly model: Observable<PullRequestScreenState>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onRefresh: () => void;
  readonly target: PullRequestTarget & { readonly host: string };
}): PullRequestActions {
  const dialog = useAppDialog();
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const runAction = useActionRunner({ capabilities, model, onRefresh, target });
  const start = useEvent((request: ScenarioRequest, to: ScenarioTarget): void => {
    request.onBegin?.();
    if (request.pendingId !== null) {
      model.pending[request.pendingId]?.set(true);
    }
    capabilities
      .startScenario(target, {
        checkId: request.checkId,
        idempotencyKey: randomUUID(),
        scenario: request.scenario,
        target: to,
        text: request.text,
      })
      .then(
        (result) => {
          request.onSettled?.(true);
          onOpenThread(result.threadId);
        },
        (error: unknown) => {
          request.onSettled?.(false);
          dialog.error("Could not start the agent", new Error(classifyForgeError(error).message));
        },
      )
      .finally(() => {
        if (request.pendingId !== null) {
          model.pending[request.pendingId]?.delete();
        }
      });
  });
  const startScenario = useEvent((request: ScenarioRequest): void => {
    const chosen = request.target ?? defaultScenarioTarget(links);
    if (chosen !== null) {
      start(request, chosen);
      return;
    }
    dialog.alert("Continue in which thread?", "Several threads are linked to this pull request.", [
      ...links.map((link) => ({
        onPress: () => {
          start(request, { kind: "thread", threadId: link.threadId });
        },
        text: describeThread(link.threadId)?.title ?? "Linked thread",
      })),
      {
        onPress: () => {
          start(request, { kind: "newThread" });
        },
        text: "New thread",
      },
      { style: "cancel", text: "Cancel" },
    ]);
  });
  const run = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    const scenario = scenarioOf(action.kind);
    if (action.availability.state === "disabled") {
      return;
    }
    if (scenario !== null) {
      const checkId = action.anchor?.kind === "checks" ? action.anchor.checkId : null;
      startScenario({ checkId, pendingId: action.actionId, scenario, target: null, text: null });
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
  return { dismissInput, pendingInput, run, startScenario, submitInput };
}
