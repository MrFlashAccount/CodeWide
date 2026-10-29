import { useEvent } from "../../react/useEvent";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { useAppNotice } from "../../ui/useAppNotice";
import { copySessionId } from "./turnActions";

import type { ThreadHeaderHostItem, ThreadHeaderProps } from "./threadHeaderContract";

const NO_HOST_ITEMS: readonly ThreadHeaderHostItem[] = [];
/** Host items share the menu's id space; the prefix keeps them apart from thread action ids. */
const HOST_ITEM_PREFIX = "host:";
const READ_ONLY_REASON = "Read-only thread";

type ThreadMenuActionId =
  | "archive"
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
  compact: "mutates",
  "copy-session-id": "reads",
  delete: "mutates",
  fork: "reads",
  pin: "mutates",
  rename: "mutates",
};

type ThreadMenuAction = ActionMenuItem & { readonly id: ThreadMenuActionId };

export function useThreadHeaderActions({
  archived,
  forkOffer,
  forkPicker,
  hostItems,
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
}: ThreadHeaderProps) {
  const dialog = useAppDialog();
  const showNotice = useAppNotice().show;
  const threadActions: ThreadMenuAction[] = [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    { icon: "pencil-outline", id: "rename", label: "Rename" },
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
  const actions = menuActions(hostItems, threadActions, readOnly);
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
  const handleAction = useEvent((id: string) => {
    if (id.startsWith(HOST_ITEM_PREFIX)) {
      const hostId = id.slice(HOST_ITEM_PREFIX.length);
      hostItems?.find((item) => item.id === hostId)?.onSelect();
      return;
    }
    // A disabled action never runs, whichever menu raised it.
    if (actions.find((item) => item.id === id)?.disabled === true) {
      return;
    }
    if (id === "copy-session-id") {
      void copySessionId(threadId, showNotice).catch((error: unknown) => {
        dialog.alert(
          "Copy failed",
          error instanceof Error ? error.message : "Could not copy session ID",
        );
      });
    } else if (id === "rename") {
      onRenameRequest();
    } else if (id === "pin") {
      run(onTogglePin, pinned ? "Unpin" : "Pin");
    } else if (
      id === "fork" &&
      onFork !== undefined &&
      forkPicker !== undefined &&
      forkOffer !== undefined
    ) {
      forkPicker.openFork({ kind: "all" }, forkOffer);
    } else if (id === "compact") {
      run(onCompact, "Compact");
    } else if (id === "archive") {
      run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    } else if (id === "delete" && onDelete !== undefined) {
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
  });

  return { actions, handleAction };
}

/** Host items first, then thread actions; a read-only thread disables the mutating ones. */
function menuActions(
  hostItems: readonly ThreadHeaderHostItem[] | undefined,
  threadActions: readonly ThreadMenuAction[],
  readOnly: boolean | undefined,
): ActionMenuItem[] {
  return [
    ...(hostItems ?? NO_HOST_ITEMS).map((item) => ({
      icon: item.icon,
      id: `${HOST_ITEM_PREFIX}${item.id}`,
      label: item.label,
    })),
    ...threadActions.map((item) => readOnlyItem(item, readOnly === true)),
  ];
}

function readOnlyItem(item: ThreadMenuAction, readOnly: boolean): ActionMenuItem {
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
