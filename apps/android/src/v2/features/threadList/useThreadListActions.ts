import type { V2Command, V2CommandTerminalFrame } from "@codewide/sync-client/v2";
import { setStringAsync } from "expo-clipboard";

import { useEvent } from "../../../react/useEvent";
import type { CommandActivationOwner } from "../../application/commandActivationOwner";
import type { ThreadPinsResource } from "../../application/resources/threadPinsResource";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { ThreadListRowActions } from "../../presentation/navigation/threadListTypes";
import { threadArchiveCommand, threadMarkReadCommand } from "./threadListCommands";

interface ThreadListActionCapabilities {
  commandActivations: CommandActivationOwner;
  threadPins: ThreadPinsResource;
}

interface UseThreadListActionsInput {
  capabilities: ThreadListActionCapabilities;
  resolveOwner(id: string): QualifiedThread | null;
}

export function useThreadListActions(input: UseThreadListActionsInput): ThreadListRowActions {
  const { capabilities, resolveOwner } = input;
  const archive = useEvent(async (id: string, archived: boolean): Promise<void> => {
    const owner = requiredOwner(resolveOwner(id));
    await execute(capabilities.commandActivations, owner, threadArchiveCommand(owner, archived));
  });
  const copyId = useEvent(async (id: string): Promise<void> => {
    const owner = requiredOwner(resolveOwner(id));
    await setStringAsync(owner.threadId);
  });
  const markRead = useEvent(async (id: string, throughActivityMarker: string): Promise<void> => {
    const owner = requiredOwner(resolveOwner(id));
    await execute(
      capabilities.commandActivations,
      owner,
      threadMarkReadCommand(owner, throughActivityMarker),
    );
  });
  const togglePin = useEvent(async (id: string, pinned: boolean): Promise<void> => {
    const owner = requiredOwner(resolveOwner(id));
    await capabilities.threadPins.setPinned(owner.savedServerId, owner.threadId, pinned);
  });
  return { archive, copyId, markRead, togglePin };
}

async function execute(
  commands: CommandActivationOwner,
  owner: QualifiedThread,
  command: V2Command,
): Promise<void> {
  const frame = await commands.execute(owner.savedServerId, command);
  assertCompleted(frame);
}

function assertCompleted(frame: V2CommandTerminalFrame): void {
  if (frame.type === "commandCompleted") return;
  throw new Error(frame.error.message);
}

function requiredOwner(owner: QualifiedThread | null): QualifiedThread {
  if (owner !== null) return owner;
  throw new Error("Thread is no longer available");
}
