import type { ForgeFailure } from "../../../data/forgeErrors";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { useAppNotice } from "../../../ui/useAppNotice";

/** PR action feedback appears above the workspace and any open native sheet. */
export function usePullRequestFeedback(): {
  readonly error: (title: string, reason: string) => void;
  readonly message: (label: string) => void;
  readonly writeFailure: (action: string, failure: ForgeFailure) => void;
} {
  const { show } = useAppNotice();
  const dialog = useAppDialog();
  const error = useEvent((title: string, reason: string): void => {
    show({
      actionLabel: "Details",
      description: reason,
      label: title,
      onActionPress: () => {
        dialog.alert(title, reason);
      },
      variant: "error",
    });
  });
  const writeFailure = useEvent((action: string, failure: ForgeFailure): void => {
    if (failure.kind === "outcomeUnknown") {
      error(
        `Unconfirmed result for ${action}`,
        `${failure.message}\nRefresh the PR before trying again.`,
      );
    } else if (failure.kind === "staleHead") {
      error(
        "PR changed since this screen loaded",
        `${action}: ${failure.message}\nCheck the updated revision before trying again.`,
      );
    } else {
      error(`${action} failed`, failure.message);
    }
  });
  const message = useEvent((label: string): void => {
    show({ label });
  });
  return { error, message, writeFailure };
}
