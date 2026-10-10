import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { TurnControlsValue } from "../../data/turn-controls-types";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import type { ProjectsWorkspaceCapabilities, ThreadStartAgent } from "./workspaceCapabilities";

type NewChatSubmission = (
  text: string,
  mode: SendMode,
  options: TurnSendOptions,
) => Promise<string>;

type NewChatSubmissionInput = {
  /** Model rows of the catalog the composer picker displayed for this draft. */
  readonly catalogModels: () => readonly TurnControlsValue["models"][number][];
  readonly closeDraft: (draftId: string) => void;
  readonly commands: Pick<ProjectsWorkspaceCapabilities, "startThread" | "startThreadInWorkspace"> &
    Pick<ComposerWorkspaceCapabilities, "sendText">;
  readonly draftChat: NewThreadDraft;
  readonly setActiveThreadId: (selectionKey: string) => void;
};

/** Binds one activation; awaits preserve the original draft and admission scope. */
export function createNewChatSubmission({
  catalogModels,
  closeDraft,
  commands,
  draftChat,
  setActiveThreadId,
}: NewChatSubmissionInput): NewChatSubmission {
  return async (text, _mode, options) => {
    const agent = threadStartAgent(options.model, catalogModels());
    let threadId: string;
    if (draftChat.workspaceMode === "isolated") {
      if (draftChat.cwd === null) {
        throw new Error("Select a project before creating a workspace");
      }
      threadId = await commands.startThreadInWorkspace(draftChat.connectionId, draftChat.cwd, {
        agent,
        requestId: draftChat.id,
      });
    } else {
      threadId = await commands.startThread(
        draftChat.connectionId,
        draftChat.cwd ?? undefined,
        agent ?? undefined,
      );
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

/**
 * The provider comes from the catalog row that offered the chosen model (ids are
 * unique in the merged catalog). Without an explicit model the Companion's default applies.
 */
function threadStartAgent(
  model: string | null | undefined,
  models: readonly TurnControlsValue["models"][number][],
): ThreadStartAgent | null {
  if (model === null || model === undefined) {
    return null;
  }
  return { model, provider: models.find((row) => row.id === model)?.provider ?? null };
}
