import type { V2Command, V2CommandResult } from "@codewide/sync-client/v2";
import { setStringAsync } from "expo-clipboard";
import { router } from "expo-router";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";

import { ThreadActionMenuView } from "../../presentation/actions/ThreadActionMenuView";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import { threadId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { serverDestination, threadDestination } from "../navigation/routeDestinations";
import { ConversationRenameSheet } from "./ConversationRenameSheet";
import { conversationThreadMenuItems } from "./conversationThreadMenuItems";

interface ConversationThreadMenuProps {
  archived: boolean;
  live: boolean;
  onBack(): void;
  onError(message: string): void;
  owner: QualifiedThread;
  title: string;
}

export function ConversationThreadMenu(props: ConversationThreadMenuProps): React.JSX.Element {
  const { archived, live, onBack, onError, owner, title } = props;
  const runtime = useV2Runtime();
  const alert = useAppDialog();
  const pins = useSyncExternalStore(
    runtime.threadPins.subscribe,
    runtime.threadPins.snapshot,
    runtime.threadPins.snapshot,
  );
  const [pinPending, startPinAction] = useTransition();
  const [threadActionPending, setThreadActionPending] = useState(false);
  const threadActionInFlight = useRef(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const pinned = pins.value.get(owner.savedServerId)?.has(owner.threadId) === true;
  const execute = useEvent((command: V2Command): Promise<V2CommandResult | null> => {
    if (!live) {
      onError("Conversation is still connecting.");
      return Promise.resolve(null);
    }
    return runtime.commandActivations.execute(owner.savedServerId, command).then(
      (frame) => {
        if (frame.type === "commandCompleted") return frame.result;
        onError(frame.error.message);
        return null;
      },
      (cause: unknown) => {
        onError(cause instanceof Error ? cause.message : "Thread action failed");
        return null;
      },
    );
  });
  const navigateToFork = useEvent((result: V2CommandResult): void => {
    if (result.kind !== "thread.fork") {
      onError("Server returned an invalid fork result.");
      return;
    }
    router.replace(
      threadDestination(qualifiedThread(owner.savedServerId, threadId(result.thread.id))),
    );
  });
  const leaveArchivedThread = useEvent((result: V2CommandResult): void => {
    if (result.kind !== "thread.update" || result.thread.id !== owner.threadId) {
      onError("Server returned an invalid archive result.");
      return;
    }
    router.replace(serverDestination(owner.savedServerId));
  });
  const completeCompaction = useEvent((result: V2CommandResult): void => {
    if (result.kind !== "thread.compact" || result.threadId !== owner.threadId) {
      onError("Server returned an invalid compact result.");
    }
  });
  const leaveDeletedThread = useEvent((result: V2CommandResult): void => {
    if (result.kind !== "thread.delete" || result.threadId !== owner.threadId) {
      onError("Server returned an invalid delete result.");
      return;
    }
    onBack();
  });
  const runThreadAction = useEvent(
    (command: V2Command, onCompleted: (result: V2CommandResult) => void): void => {
      if (threadActionInFlight.current) return;
      threadActionInFlight.current = true;
      setThreadActionPending(true);
      execute(command).then(
        (result) => {
          threadActionInFlight.current = false;
          setThreadActionPending(false);
          if (result !== null) onCompleted(result);
        },
        (cause: unknown) => {
          threadActionInFlight.current = false;
          setThreadActionPending(false);
          onError(cause instanceof Error ? cause.message : "Thread action failed");
        },
      );
    },
  );
  const select = useEvent((id: string) => {
    if (id === "copy-session-id") {
      setStringAsync(owner.threadId).catch(() => onError("Could not copy session ID."));
      return;
    }
    if (id === "rename") {
      setRenameVisible(true);
      return;
    }
    if (id === "pin") {
      startPinAction(() =>
        runtime.threadPins
          .setPinned(owner.savedServerId, owner.threadId, !pinned)
          .then(undefined, () => onError("Could not update pinned threads.")),
      );
      return;
    }
    if (id === "fork") {
      runThreadAction(
        {
          kind: "thread.fork",
          threadId: owner.threadId,
          throughTurnId: null,
        },
        navigateToFork,
      );
      return;
    }
    if (id === "compact") {
      runThreadAction({ kind: "thread.compact", threadId: owner.threadId }, completeCompaction);
      return;
    }
    if (id === "archive") {
      runThreadAction(
        {
          change: { archived: !archived, kind: "archive" },
          kind: "thread.update",
          threadId: owner.threadId,
        },
        leaveArchivedThread,
      );
      return;
    }
    if (id !== "delete") return;
    alert("Delete thread?", "This permanently deletes the thread on the selected server.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          runThreadAction({ kind: "thread.delete", threadId: owner.threadId }, leaveDeletedThread);
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  });
  const closeRename = useEvent(() => setRenameVisible(false));
  return (
    <>
      <ThreadActionMenuView
        actions={conversationThreadMenuItems(
          archived,
          pinned,
          pinPending,
          threadActionPending,
          live,
        )}
        onSelect={select}
      />
      {renameVisible ? (
        <ConversationRenameSheet live={live} onClose={closeRename} owner={owner} title={title} />
      ) : null}
    </>
  );
}
