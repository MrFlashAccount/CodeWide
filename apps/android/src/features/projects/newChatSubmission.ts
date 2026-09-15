import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import type { NewChatDraft, SelectWorkspaceThread } from "../navigation/threadNavigation";
import { threadSelectionKey } from "../navigation/threadSelection";
import type { ProjectsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Binds one activation; awaits preserve the original draft and admission scope. */
export function createNewChatSubmission(
  draftChat: NewChatDraft,
  commands: Pick<ProjectsWorkspaceCapabilities, "startThread" | "startThreadInWorkspace"> &
    Pick<ComposerWorkspaceCapabilities, "sendText">,
  setActiveThreadId: SelectWorkspaceThread,
) {
  return async (text: string, _mode: SendMode, options: TurnSendOptions) => {
    let threadId: string;
    if (draftChat.workspaceMode === "isolated") {
      if (draftChat.cwd === null) throw new Error("Select a project before creating a workspace");
      threadId = await commands.startThreadInWorkspace(
        draftChat.serverId,
        draftChat.cwd,
        draftChat.id,
      );
    } else {
      threadId = await commands.startThread(draftChat.serverId, draftChat.cwd ?? undefined);
    }
    const commandId = await commands.sendText(
      draftChat.serverId,
      threadId,
      text,
      { type: "start" },
      draftChat.workspaceMode === "isolated"
        ? { ...options, workspaceRequestId: draftChat.id }
        : options,
    );
    setActiveThreadId(
      threadSelectionKey({ id: threadId, serverId: draftChat.serverId }),
      undefined,
      draftChat.serverId,
    );
    return commandId;
  };
}
