import { type RenderBlock } from "@codewide/renderers";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import {
  renderRecoveryPrompt,
  type RecoverableRenderFailure,
} from "../../ui/render-recovery-prompt";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import { workspaceConversationScope } from "../navigation/conversationScope";
import type { SelectWorkspaceThread } from "../navigation/threadNavigation";
import { type ThreadNavigationModel } from "../navigation/threadNavigation";
import { threadSelectionKey } from "../navigation/threadSelection";
import type { ProjectsWorkspaceCapabilities } from "../projects/workspaceCapabilities";
import type { TurnActionsWorkspaceCapabilities } from "../turnActions/workspaceCapabilities";
/** Explicit recovery activations reuse normal thread creation and durable submission. */
export function useRenderRecovery(
  actions: Pick<ProjectsWorkspaceCapabilities, "startThread"> &
    Pick<TurnActionsWorkspaceCapabilities, "renameThread"> &
    Pick<ComposerWorkspaceCapabilities, "sendText">,
  threadNavigation: ThreadNavigationModel,
  activeServerId: string,
  loadedThreadSummaries: StoredThreadSummary[],
  setActiveThreadId: SelectWorkspaceThread,
) {
  const createRepairThread = async (title: string, prompt: string): Promise<void> => {
    const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } =
      workspaceConversationScope(threadNavigation.destination$.peek(), activeServerId);
    if (activeConnectionId === "") throw new Error("No server selected");
    const currentCwd = loadedThreadSummaries.find(
      (candidate) =>
        candidate.connectionId === activeConnectionId &&
        candidate.remoteThreadId === activeRemoteThreadId,
    )?.cwd;
    const threadId = await actions.startThread(activeConnectionId, currentCwd);
    await actions.renameThread(activeConnectionId, threadId, title);
    await actions.sendText(activeConnectionId, threadId, prompt, { type: "start" });
    setActiveThreadId(
      threadSelectionKey({ serverId: activeConnectionId, id: threadId }),
      undefined,
      activeConnectionId,
    );
  };
  const createUnsupportedFixThread = useEvent(async (block: RenderBlock): Promise<void> => {
    const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
    const raw = JSON.stringify(block.raw, null, 2) ?? "{}";
    const prompt = [
      `Implement support for the Codex protocol block \`${rawType}\` in this remote client.`,
      "Inspect the renderer registry, add a compact safe renderer, preserve unknown-field compatibility, and add regression tests.",
      "Raw block:",
      "```json",
      raw.slice(0, 12_000),
      "```",
    ].join("\n\n");
    await createRepairThread(`Support ${rawType}`, prompt);
  });
  const createRenderFailureFixThread = useEvent(
    async (failure: RecoverableRenderFailure): Promise<void> => {
      const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } =
        workspaceConversationScope(threadNavigation.destination$.peek(), activeServerId);
      const activeCwd =
        loadedThreadSummaries.find(
          (row) =>
            row.connectionId === activeConnectionId && row.remoteThreadId === activeRemoteThreadId,
        )?.cwd ?? "/workspace";
      const threadContext =
        activeRemoteThreadId === null
          ? "No thread selected"
          : `Connection: ${activeConnectionId}\nThread: ${activeRemoteThreadId}\nCWD: ${activeCwd}`;
      await createRepairThread(
        `Fix ${failure.label}`.slice(0, 80),
        renderRecoveryPrompt({
          ...failure,
          context: [threadContext, failure.context]
            .filter((value): value is string => value !== undefined && value !== "")
            .join("\n"),
        }),
      );
    },
  );

  return { createUnsupportedFixThread, createRenderFailureFixThread };
}
