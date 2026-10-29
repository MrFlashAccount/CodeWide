import type { Observable } from "@legendapp/state";
import { randomUUID } from "expo-crypto";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { classifyForgeError, type ForgeFailure } from "../../../data/forgeErrors";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { ActionNotice, PullRequestScreenState } from "../pullRequestScreenModel";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
} from "../workspaceCapabilities";
import { confirmationCopy } from "./confirmationCopy";
import { effectiveConfirmation } from "./confirmationPolicy";
import { createIdempotencyKeys } from "./idempotencyKeys";

/** The screen notice a failed run leaves: stale head, unknown outcome, or the forge's refusal. */
function failureNotice(action: ActionDescriptor, failure: ForgeFailure): ActionNotice {
  if (failure.kind === "staleHead") {
    return { kind: "stale" };
  }
  if (failure.kind === "outcomeUnknown") {
    return { kind: "outcomeUnknown" };
  }
  return {
    actionId: action.actionId,
    kind: "refused",
    reason: failure.message,
  };
}

/**
 * Runs one catalog action: confirmation at the effective level, an
 * idempotency key per user intent (kept across a retry after a transport
 * failure), pending state in the screen model, and typed recovery — a moved
 * head shows the stale banner and refreshes, a forge refusal restores the
 * previous state and shows its reason.
 */
export function useActionRunner({
  capabilities,
  model,
  onRefresh,
  target,
}: {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly model: Observable<PullRequestScreenState>;
  readonly onRefresh: () => void;
  readonly target: PullRequestTarget & { readonly host: string };
}): (action: ActionDescriptor, input: boolean | string | null) => void {
  const dialog = useAppDialog();
  const keys = useConstant(() => createIdempotencyKeys(randomUUID));
  const settle = useEvent((action: ActionDescriptor): void => {
    model.pending[action.actionId]?.delete();
    model.pendingToggles[action.actionId]?.delete();
  });
  const execute = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    const idempotencyKey = keys.keyFor(action.actionId);
    model.pending[action.actionId]?.set(true);
    if (action.toggle !== null) {
      model.pendingToggles[action.actionId]?.set(!action.toggle.on);
    }
    model.notice.set(null);
    capabilities
      .runAction(target, {
        actionId: action.actionId,
        confirmation: effectiveConfirmation(action),
        idempotencyKey,
        input,
      })
      .then(
        (result) => {
          keys.settle(action.actionId, null);
          model.notice.set(
            result.message === null ? null : { kind: "message", text: result.message },
          );
        },
        (error: unknown) => {
          const failure = classifyForgeError(error);
          keys.settle(action.actionId, failure);
          model.notice.set(failureNotice(action, failure));
          onRefresh();
        },
      )
      .finally(() => {
        settle(action);
      });
  });
  return useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    if (
      action.availability.state === "disabled" ||
      model.pending[action.actionId]?.peek() === true
    ) {
      return;
    }
    const level = effectiveConfirmation(action);
    if (level === "none") {
      execute(action, input);
      return;
    }
    const copy = confirmationCopy(action, input, target.host);
    dialog.alert(copy.title, copy.consequence, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          execute(action, input);
        },
        style: level === "destructive" ? "destructive" : "default",
        text: copy.confirmLabel,
      },
    ]);
  });
}
