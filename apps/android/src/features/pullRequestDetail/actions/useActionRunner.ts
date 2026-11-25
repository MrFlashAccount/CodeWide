import type { Observable } from "@legendapp/state";
import { randomUUID } from "expo-crypto";
import { Linking } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { classifyForgeError } from "../../../data/forgeErrors";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { PullRequestScreenState } from "../pullRequestScreenModel";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
} from "../workspaceCapabilities";
import { confirmationCopy } from "./confirmationCopy";
import { usePullRequestFeedback } from "./usePullRequestFeedback";
import { effectiveConfirmation } from "./confirmationPolicy";
import { createIdempotencyKeys } from "./idempotencyKeys";

/**
 * Runs one catalog action: confirmation at the effective level, an
 * idempotency key per user intent (kept across a retry after a transport
 * failure), pending state in the screen model, the forge page a run asks to
 * finish on, and typed recovery — a moved
 * head shows a notice and refreshes, a forge refusal restores the
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
  const feedback = usePullRequestFeedback();
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
          if (result.message !== null && (action.kind !== "autoMerge" || result.openUrl !== null)) {
            feedback.message(result.message);
          }
          // The forge accepts this action only on its web page: the person finishes it there.
          if (result.openUrl !== null) {
            Linking.openURL(result.openUrl).catch(() => undefined);
          }
        },
        (error: unknown) => {
          const failure = classifyForgeError(error);
          keys.settle(action.actionId, failure);
          feedback.writeFailure(action.label, failure);
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
