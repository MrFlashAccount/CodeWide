import { useEvent } from "../../react/useEvent";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { useAppNotice } from "../../ui/useAppNotice";
import { copySessionId } from "./turnActions";

import type { ThreadHeaderProps } from "./threadHeaderContract";

const READ_ONLY_REASON = "Read-only thread";

type ThreadMenuActionId =
  | "archive"
  | "attach-pull-request"
  | "compact"
  | "copy-session-id"
  | "delete"
  | "fork"
  | "pin"
  | "rename";

/**
 * Whether each thread action changes the thread. A read-only thread (a sub-agent its parent
 * drives) keeps every action that only reads it and shows the mutating ones disabled. Forking
 * reads the thread into a new one, so it stays available. Every action must be classified here.
 */
const THREAD_MENU_EFFECTS: Readonly<Record<ThreadMenuActionId, "mutates" | "reads">> = {
  archive: "mutates",
  "attach-pull-request": "mutates",
  compact: "mutates",
  "copy-session-id": "reads",
  delete: "mutates",
  fork: "reads",
  pin: "mutates",
  rename: "mutates",
};

type ThreadMenuAction = ActionMenuItem & { readonly id: ThreadMenuActionId };

export function useThreadHeaderActions(
  {
    archived,
    forkOffer,
    forkPicker,
    onArchive,
    onCompact,
    onDelete,
    onFork,
    onRenameRequest,
    onTogglePin,
    onUnarchive,
    openElsewhere = false,
    pinned,
    readOnly,
    threadId,
  }: ThreadHeaderProps,
  openPullRequestPicker: (() => void) | null,
): { readonly actions: readonly ActionMenuItem[]; readonly handleAction: (id: string) => void } {
  const dialog = useAppDialog();
  const showNotice = useAppNotice().show;
  const threadActions: ThreadMenuAction[] = [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    { icon: "pencil-outline", id: "rename", label: "Rename" },
    {
      disabled: openPullRequestPicker === null,
      icon: "attach-outline",
      id: "attach-pull-request",
      label: "Attach pull request",
    },
    {
      disabled: onTogglePin === undefined,
      icon: "pin-outline",
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      selected: pinned,
    },
    {
      disabled: onFork === undefined || forkPicker === undefined || forkOffer === undefined,
      icon: "git-branch-outline",
      id: "fork",
      label: "Fork thread",
    },
    sessionItem(
      { icon: "contract-outline", id: "compact", label: "Compact context" },
      onCompact,
      openElsewhere,
    ),
    {
      disabled: archived ? onUnarchive === undefined : onArchive === undefined,
      icon: archived ? "archive" : "archive-outline",
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
    },
    sessionItem(
      { destructive: true, icon: "trash-outline", id: "delete", label: "Delete thread" },
      onDelete,
      openElsewhere,
    ),
  ];
  const actions = threadActions.map((item) => readOnlyItem(item, readOnly === true));
  const run = useEvent((action: (() => Promise<void>) | undefined, label: string) => {
    if (action === undefined) {
      return;
    }
    void action().catch((error: unknown) => {
      dialog.alert(
        `${label} failed`,
        error instanceof Error ? error.message : "Thread action failed",
      );
    });
  });
  const handlers: Record<ThreadMenuActionId, () => void> = {
    archive: () => {
      run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    },
    "attach-pull-request": () => {
      openPullRequestPicker?.();
    },
    compact: () => {
      run(onCompact, "Compact");
    },
    "copy-session-id": () => {
      copySessionId(threadId, showNotice).catch((error: unknown) => {
        dialog.alert(
          "Copy failed",
          error instanceof Error ? error.message : "Could not copy session ID",
        );
      });
    },
    delete: () => {
      if (onDelete !== undefined) {
        dialog.alert(
          "Delete thread?",
          "This permanently deletes the thread on the selected server.",
          [
            { style: "cancel", text: "Cancel" },
            {
              onPress: () => {
                run(onDelete, "Delete");
              },
              style: "destructive",
              text: "Delete",
            },
          ],
        );
      }
    },
    fork: () => {
      if (forkOffer !== undefined) {
        forkPicker?.openFork({ kind: "all" }, forkOffer);
      }
    },
    pin: () => {
      run(onTogglePin, pinned ? "Unpin" : "Pin");
    },
    rename: onRenameRequest,
  };
  const handleAction = useEvent((id: string) => {
    const action = actions.find((item) => item.id === id);
    if (action !== undefined && action.disabled !== true) {
      handlers[action.id]();
    }
  });

  return { actions, handleAction };
}

/** A read-only thread disables the mutating actions. */
function readOnlyItem(item: ThreadMenuAction, readOnly: boolean): ThreadMenuAction {
  return readOnly && THREAD_MENU_EFFECTS[item.id] === "mutates"
    ? { ...item, description: READ_ONLY_REASON, disabled: true }
    : item;
}

/** An action that needs the thread's session: off, with the reason, while another app holds it. */
function sessionItem(
  item: ThreadMenuAction,
  action: (() => Promise<void>) | undefined,
  openElsewhere: boolean,
): ThreadMenuAction {
  return openElsewhere
    ? { ...item, description: "Open in another app", disabled: true }
    : { ...item, disabled: action === undefined };
}
