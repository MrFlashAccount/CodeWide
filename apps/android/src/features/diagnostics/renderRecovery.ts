import type { RenderBlock } from "@codewide/renderers";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import {
  threadSelectionKey,
  type SelectWorkspaceThread,
  type V1ThreadRouteParams,
} from "../../services/threads/threadRouteParams";
import {
  renderRecoveryPrompt,
  type RecoverableRenderFailure,
} from "../../ui/render-recovery-prompt";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import type { ProjectsWorkspaceCapabilities } from "../projects/workspaceCapabilities";
import type { TurnActionsWorkspaceCapabilities } from "../turnActions/workspaceCapabilities";

type RenderRecoveryActions = Pick<ProjectsWorkspaceCapabilities, "startThread"> &
  Pick<TurnActionsWorkspaceCapabilities, "renameThread"> &
  Pick<ComposerWorkspaceCapabilities, "sendText">;

type RenderRecoveryInput = {
  readonly actions: RenderRecoveryActions;
  readonly currentThread: V1ThreadRouteParams | null;
  readonly fallbackConnectionId: string | null;
  readonly loadedThreadSummaries: StoredThreadSummary[];
  readonly setActiveThreadId: SelectWorkspaceThread;
};

export type RenderRecoveryBinding = {
  readonly createRenderFailureFixThread: (failure: RecoverableRenderFailure) => Promise<void>;
  readonly createUnsupportedFixThread: (block: RenderBlock) => Promise<void>;
};

// Recovery prompts cap embedded protocol diagnostics to keep a repair request bounded.
const MAX_RAW_BLOCK_LENGTH = 12_000;
// Recovery thread titles are capped to the existing compact thread-title contract.
const MAX_RECOVERY_TITLE_LENGTH = 80;

/** Explicit recovery activations reuse normal thread creation and durable submission. */
export function useRenderRecovery({
  actions,
  currentThread,
  fallbackConnectionId,
  loadedThreadSummaries,
  setActiveThreadId,
}: RenderRecoveryInput): RenderRecoveryBinding {
  const createRepairThread = async (title: string, prompt: string): Promise<void> => {
    const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } = recoveryScope(
      currentThread,
      fallbackConnectionId,
    );
    if (activeConnectionId === "") {
      throw new Error("No server selected");
    }
    const currentCwd = loadedThreadSummaries.find(
      (candidate) =>
        candidate.connectionId === activeConnectionId &&
        candidate.remoteThreadId === activeRemoteThreadId,
    )?.cwd;
    const threadId = await actions.startThread(activeConnectionId, currentCwd);
    await actions.renameThread(activeConnectionId, threadId, title);
    await actions.sendText(activeConnectionId, threadId, prompt, { type: "start" });
    setActiveThreadId(threadSelectionKey({ id: threadId, serverId: activeConnectionId }));
  };
  const createUnsupportedFixThread = useEvent(async (block: RenderBlock): Promise<void> => {
    const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
    const raw = JSON.stringify(block.raw, null, "  ");
    const prompt = [
      `Implement support for the Codex protocol block \`${rawType}\` in this remote client.`,
      "Inspect the renderer registry, add a compact safe renderer, preserve unknown-field compatibility, and add regression tests.",
      "Raw block:",
      "```json",
      raw.slice(0, MAX_RAW_BLOCK_LENGTH),
      "```",
    ].join("\n\n");
    await createRepairThread(`Support ${rawType}`, prompt);
  });
  const createRenderFailureFixThread = useEvent(
    async (failure: RecoverableRenderFailure): Promise<void> => {
      const threadContext = renderFailureThreadContext(
        currentThread,
        fallbackConnectionId,
        loadedThreadSummaries,
      );
      await createRepairThread(
        `Fix ${failure.label}`.slice(0, MAX_RECOVERY_TITLE_LENGTH),
        renderRecoveryPrompt({
          ...failure,
          context: [threadContext, failure.context]
            .filter((value): value is string => value !== undefined && value !== "")
            .join("\n"),
        }),
      );
    },
  );

  return { createRenderFailureFixThread, createUnsupportedFixThread };
}

function renderFailureThreadContext(
  currentThread: V1ThreadRouteParams | null,
  fallbackConnectionId: string | null,
  loadedThreadSummaries: readonly StoredThreadSummary[],
): string {
  const { connectionId, threadId } = recoveryScope(currentThread, fallbackConnectionId);
  if (threadId === null) {
    return "No thread selected";
  }
  const cwd =
    loadedThreadSummaries.find(
      (row) => row.connectionId === connectionId && row.remoteThreadId === threadId,
    )?.cwd ?? "/workspace";
  return `Connection: ${connectionId}\nThread: ${threadId}\nCWD: ${cwd}`;
}

function recoveryScope(
  currentThread: V1ThreadRouteParams | null,
  fallbackConnectionId: string | null,
): { readonly connectionId: string; readonly threadId: string | null } {
  if (currentThread !== null) {
    return {
      connectionId: currentThread.connectionId.value,
      threadId: currentThread.threadId.value,
    };
  }
  return { connectionId: fallbackConnectionId ?? "", threadId: null };
}
