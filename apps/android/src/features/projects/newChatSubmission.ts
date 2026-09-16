import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import {
  threadSelectionKey,
  type SelectWorkspaceThread,
} from "../../services/threads/threadRouteParams";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import type { ProjectsWorkspaceCapabilities } from "./workspaceCapabilities";

type NewChatSubmission = (
  text: string,
  mode: SendMode,
  options: TurnSendOptions,
) => Promise<string>;

type NewChatSubmissionInput = {
  readonly closeDraft: (draftId: string) => void;
  readonly commands: Pick<ProjectsWorkspaceCapabilities, "startThread" | "startThreadInWorkspace"> &
    Pick<ComposerWorkspaceCapabilities, "sendText">;
  readonly draftChat: NewThreadDraft;
  readonly setActiveThreadId: SelectWorkspaceThread;
};

/** Binds one activation; awaits preserve the original draft and admission scope. */
export function createNewChatSubmission({
  closeDraft,
  commands,
  draftChat,
  setActiveThreadId,
}: NewChatSubmissionInput): NewChatSubmission {
  return async (text, _mode, options) => {
    let threadId: string;
    if (draftChat.workspaceMode === "isolated") {
      if (draftChat.cwd === null) {
        throw new Error("Select a project before creating a workspace");
      }
      threadId = await commands.startThreadInWorkspace(
        draftChat.connectionId,
        draftChat.cwd,
        draftChat.id,
      );
    } else {
      threadId = await commands.startThread(draftChat.connectionId, draftChat.cwd ?? undefined);
    }
    const commandId = await commands.sendText(
      draftChat.connectionId,
      threadId,
      text,
      { type: "start" },
      draftChat.workspaceMode === "isolated"
        ? { ...options, workspaceRequestId: draftChat.id }
        : options,
    );
    setActiveThreadId(threadSelectionKey({ id: threadId, serverId: draftChat.connectionId }));
    closeDraft(draftChat.id);
    return commandId;
  };
}
