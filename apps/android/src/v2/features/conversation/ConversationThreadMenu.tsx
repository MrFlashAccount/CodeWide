import type { V2Command } from "@codewide/sync-client/v2";
import { setStringAsync } from "expo-clipboard";
import { useState } from "react";

import { ThreadActionMenuView } from "../../../presentation/actions/ThreadActionMenuView";
import { useEvent } from "../../../react/useEvent";
import type { ActionMenuItem } from "../../../ui/ActionMenu";
import { useAppDialog } from "../../../ui/AppDialog";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";

interface ConversationThreadMenuProps {
  archived: boolean;
  onBack(): void;
  onError(message: string): void;
  owner: QualifiedThread;
}

export function ConversationThreadMenu({
  archived,
  onBack,
  onError,
  owner,
}: ConversationThreadMenuProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const dialog = useAppDialog();
  const [pinned, setPinned] = useState(false);
  const execute = useEvent(async (command: V2Command): Promise<boolean> => {
    try {
      const frame = await runtime.commands.execute(owner.savedServerId, command);
      if (frame.type !== "commandCompleted") {
        onError(frame.error.message);
        return false;
      }
      return true;
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : "Thread action failed");
      return false;
    }
  });
  const select = useEvent((id: string) => {
    if (id === "copy-session-id") {
      setStringAsync(owner.threadId).catch(() => onError("Could not copy session ID."));
      return;
    }
    if (id === "rename") {
      onError("Rename is not available yet.");
      return;
    }
    if (id === "pin") {
      setPinned((current) => !current);
      return;
    }
    if (id === "fork") {
      execute({ kind: "thread.fork", threadId: owner.threadId, throughTurnId: null }).catch(
        () => undefined,
      );
      return;
    }
    if (id === "compact") {
      execute({ kind: "thread.compact", threadId: owner.threadId }).catch(() => undefined);
      return;
    }
    if (id === "archive") {
      execute({
        change: { archived: !archived, kind: "archive" },
        kind: "thread.update",
        threadId: owner.threadId,
      }).catch(() => undefined);
      return;
    }
    if (id !== "delete") return;
    dialog.alert("Delete thread?", "This permanently deletes the thread on the selected server.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          execute({ kind: "thread.delete", threadId: owner.threadId }).then(
            (completed) => {
              if (completed) onBack();
            },
            () => undefined,
          );
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  });
  return <ThreadActionMenuView actions={threadActions(archived, pinned)} onSelect={select} />;
}

function threadActions(archived: boolean, pinned: boolean): ActionMenuItem[] {
  return [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    { icon: "pencil-outline", id: "rename", label: "Rename" },
    {
      icon: pinned ? "pin" : "pin-outline",
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      selected: pinned,
    },
    { icon: "git-branch-outline", id: "fork", label: "Fork thread" },
    { icon: "contract-outline", id: "compact", label: "Compact context" },
    {
      icon: archived ? "archive" : "archive-outline",
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
    },
    { destructive: true, icon: "trash-outline", id: "delete", label: "Delete thread" },
  ];
}
