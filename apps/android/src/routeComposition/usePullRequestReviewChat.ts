import { randomUUID } from "expo-crypto";
import { useLayoutEffect, useRef, useState } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import type { ReviewChatOpening } from "../data/forgeMutationContract";
import type { ThreadId } from "../data/reviewContract";
import type { DraftSubmission } from "../features/conversation/ConversationWorkspace.types";
import type { ComposerWorkspaceCapabilities } from "../features/composer/workspaceCapabilities";
import type { DeferReviewChatScenario } from "../features/pullRequestDetail/pullRequestScreenContract";
import type { PullRequestDetailWorkspaceCapabilities } from "../features/pullRequestDetail/workspaceCapabilities";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { useAppDialog } from "../ui/AppDialog";
import { usePaneRearrangement } from "./paneMotion";
import { linkedThreadSelectionKey, usePullRequestNavigation } from "./pullRequestNavigation";
import {
  type ReviewChatDraft,
  withProject,
  withScenario,
  withSuggestions,
} from "./reviewChatDraft";

export type PullRequestChatState =
  | { readonly status: "closed" }
  | { readonly draft: ReviewChatDraft; readonly status: "draft" }
  | { readonly status: "open"; readonly threadId: ThreadId };

/** The draft's own commands; each acts only on the draft that is currently presented. */
export type ReviewChatDraftCommands = {
  readonly chooseProject: (path: string) => void;
  /** Creates the chat in the chosen project with this first message, then opens it. */
  readonly send: DraftSubmission;
  readonly startScenario: () => void;
};

/** The deferred scenario's continuation; dismissed or replaced, it settles exactly once. */
type PendingScenario = {
  readonly settle: (threadId: ThreadId | null) => void;
  readonly start: (path: string) => Promise<ThreadId>;
};

/**
 * Owns one PR route's review-chat presentation. A chat the overview
 * names opens at once. Without one, the review-chat draft opens at once, exactly like a new
 * chat: the Companion's suggested projects arrive in the background (the first is pre-selected)
 * and nothing is created until the first send, or until a deferred scenario starts, in the
 * chosen project. A suggestion request that finds a live linked chat opens that chat instead.
 * Results act only while their attempt is current: dismissal, identity changes, unmount and newer
 * attempts invalidate older work without cancelling the shared RPC. Only phones navigate to the
 * Threads tab, preserving prepare-before-navigate ordering; navigation never happens while the
 * route is inactive.
 */
export function usePullRequestReviewChat({
  connectionId,
  desktop,
  ensureReviewChat,
  prepareThreadLink,
  pullRequest,
  routeActive,
  sendText,
}: {
  readonly connectionId: string;
  readonly desktop: boolean;
  readonly ensureReviewChat: PullRequestDetailWorkspaceCapabilities["ensureReviewChat"];
  readonly prepareThreadLink: (selectionKey: string) => void;
  readonly pullRequest: PullRequestKey;
  readonly routeActive: boolean;
  readonly sendText: ComposerWorkspaceCapabilities["sendText"];
}): {
  readonly chat: PullRequestChatState;
  readonly deferScenario: DeferReviewChatScenario;
  /** Closes the chat at once; the pane layout runs it inside its own rearrangement. */
  readonly dismissChat: () => void;
  readonly draft: ReviewChatDraftCommands;
  readonly openReviewChat: (reviewThread: ThreadId | null) => void;
  readonly openThread: (threadId: ThreadId) => void;
} {
  const dialog = useAppDialog();
  const navigation = usePullRequestNavigation();
  // Opening and closing the chat beside the PR are the rearrangements that animate the
  // desktop panes. A phone presents the chat over the PR without moving panes, so it applies
  // changes immediately.
  const paneRearrangement = usePaneRearrangement();
  const rearrange = desktop ? paneRearrangement : applyImmediately;
  const [chat, setChat] = useState<PullRequestChatState>({ status: "closed" });
  const activeAttempt = useRef<number | null>(null);
  const nextAttemptId = useRef(0);
  const pendingScenario = useRef<PendingScenario | null>(null);
  const draftId = useConstant(() => `review-chat-draft-${randomUUID()}`);
  // Any desktop layout (an unfolded Fold included) keeps the chat beside the PR, where the pane
  // frame lets it cover the catalog. Only phones navigate to the Threads tab.
  const wideChat = desktop;
  const target = { connectionId, pullRequest };
  const beginAttempt = useEvent((): number => {
    nextAttemptId.current += 1;
    activeAttempt.current = nextAttemptId.current;
    return nextAttemptId.current;
  });
  const settleScenario = useEvent((threadId: ThreadId | null): void => {
    const pending = pendingScenario.current;
    pendingScenario.current = null;
    pending?.settle(threadId);
  });
  const dismissChat = useEvent((): void => {
    activeAttempt.current = null;
    settleScenario(null);
    setChat({ status: "closed" });
  });
  const navigateToLinkedThread = useEvent((threadId: ThreadId): void => {
    prepareThreadLink(linkedThreadSelectionKey(connectionId, threadId));
    navigation.navigateToLinkedThread(connectionId, threadId);
  });
  const openThread = useEvent((threadId: ThreadId): void => {
    activeAttempt.current = null;
    // The chat now exists: a scenario still waiting in the draft is discarded.
    settleScenario(null);
    if (wideChat) {
      rearrange(() => {
        setChat({ status: "open", threadId });
      });
      return;
    }
    try {
      navigateToLinkedThread(threadId);
      setChat({ status: "closed" });
    } catch (error: unknown) {
      setChat({ status: "closed" });
      dialog.error("Could not open the review chat", error);
    }
  });
  const presentDraft = useEvent((draft: ReviewChatDraft): void => {
    if (chat.status === "draft") {
      setChat({ draft, status: "draft" });
      return;
    }
    rearrange(() => {
      setChat({ draft, status: "draft" });
    });
  });
  const updateDraft = useEvent((change: (draft: ReviewChatDraft) => ReviewChatDraft): void => {
    setChat((current) =>
      current.status === "draft" ? { draft: change(current.draft), status: "draft" } : current,
    );
  });
  // Settlements are separate events: after an await they read the current route state, never
  // the state captured when the request started.
  const settleSuggestions = useEvent(
    (attempt: number, suggestions: ReviewChatOpening | null): void => {
      if (activeAttempt.current !== attempt) {
        return;
      }
      if (suggestions?.kind === "ready" && routeActive) {
        // A live linked chat exists after all: present it instead of the draft.
        openThread(suggestions.threadId);
        return;
      }
      activeAttempt.current = null;
      // Without suggestions (a failed request, or a live chat found while the route is hidden,
      // which never navigates) the draft stays usable; its first send reaches the live chat.
      updateDraft((draft) =>
        withSuggestions(
          draft,
          suggestions?.kind === "needsWorkspace" ? suggestions.candidates : [],
        ),
      );
    },
  );
  const requestSuggestions = useEvent(async (attempt: number): Promise<void> => {
    const suggestions = await ensureReviewChat(target, { kind: "ask" }).catch(() => null);
    settleSuggestions(attempt, suggestions);
  });
  const openReviewChat = useEvent((reviewThread: ThreadId | null): void => {
    if (!routeActive) {
      return;
    }
    if (reviewThread !== null) {
      openThread(reviewThread);
      return;
    }
    if (chat.status === "draft") {
      return;
    }
    const attempt = beginAttempt();
    presentDraft({ cwd: null, id: draftId, scenario: null, suggestions: null });
    requestSuggestions(attempt).catch(() => undefined);
  });
  const deferScenario = useEvent<DeferReviewChatScenario>(
    async ({ candidates, label, start }) =>
      new Promise<ThreadId | null>((resolve) => {
        if (!routeActive) {
          resolve(null);
          return;
        }
        // A newer scenario replaces the one still waiting; its suggestions replace any request.
        settleScenario(null);
        activeAttempt.current = null;
        pendingScenario.current = { settle: resolve, start };
        const base =
          chat.status === "draft"
            ? chat.draft
            : { cwd: null, id: draftId, scenario: null, suggestions: null };
        presentDraft(
          withScenario(withSuggestions(base, candidates), {
            error: null,
            label,
            status: "pending",
          }),
        );
      }),
  );
  const chooseProject = useEvent((path: string): void => {
    updateDraft((draft) => withProject(draft, path));
  });
  const startScenario = useEvent((): void => {
    const pending = pendingScenario.current;
    if (
      pending === null ||
      chat.status !== "draft" ||
      chat.draft.cwd === null ||
      chat.draft.scenario?.status !== "pending"
    ) {
      return;
    }
    const label = chat.draft.scenario.label;
    updateDraft((draft) => withScenario(draft, { label, status: "starting" }));
    pending.start(chat.draft.cwd).then(
      (threadId) => {
        // The screen opens the started chat once the deferred start settles.
        if (pendingScenario.current === pending) {
          settleScenario(threadId);
        }
      },
      (error: unknown) => {
        if (pendingScenario.current === pending) {
          updateDraft((draft) =>
            withScenario(draft, {
              error: error instanceof Error ? error.message : `Could not start ${label}`,
              label,
              status: "pending",
            }),
          );
        }
      },
    );
  });
  const settleSend = useEvent((attempt: number, threadId: ThreadId): void => {
    if (activeAttempt.current === attempt && routeActive) {
      openThread(threadId);
    }
  });
  const send = useEvent<DraftSubmission>(async (text, _mode, options) => {
    if (chat.status !== "draft" || chat.draft.cwd === null) {
      throw new Error("Choose a project before sending");
    }
    const attempt = beginAttempt();
    const opening = await ensureReviewChat(target, { kind: "path", path: chat.draft.cwd });
    if (opening.kind !== "ready") {
      throw new Error("Choose a project folder for the review chat");
    }
    // The new chat starts with this message, exactly as a new chat's first send does.
    const commandId = await sendText(
      connectionId,
      opening.threadId,
      text,
      { type: "start" },
      options,
    );
    settleSend(attempt, opening.threadId);
    return commandId;
  });
  useLayoutEffect(
    () => () => {
      activeAttempt.current = null;
      settleScenario(null);
    },
    [connectionId, pullRequest, settleScenario],
  );

  return {
    chat,
    deferScenario,
    dismissChat,
    draft: { chooseProject, send, startScenario },
    openReviewChat,
    openThread,
  };
}

function applyImmediately(change: () => void): void {
  change();
}
