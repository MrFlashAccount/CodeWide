import { useSelector } from "@legendapp/state/react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";

import { parseActionCatalog, type ActionDescriptor } from "../src/data/forgeActionCatalog";
import { headRevision, parsePullRequestKeyParam } from "../src/data/forgeContract";
import { parsePullRequestScenarios } from "../src/data/forgeScenarioContract";
import { threadId, type ThreadId } from "../src/data/reviewContract";
import {
  scenarioViews,
  type ScenarioViews,
} from "../src/features/pullRequestDetail/actions/scenarioRuns";
import { ScenarioViewsContext } from "../src/features/pullRequestDetail/actions/ScenarioViewsContext";
import { usePullRequestActions } from "../src/features/pullRequestDetail/actions/usePullRequestActions";
import { AgentSection } from "../src/features/pullRequestDetail/overview/AgentSection";
import { createPullRequestScreenModel } from "../src/features/pullRequestDetail/pullRequestScreenModel";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import { AppText } from "../src/ui/AppText";
import { resetAppDialog } from "./mocks/AppDialog";

const HEAD = headRevision("head-2", "headRevision");
const REVIEW_CHAT = threadId("thread-review-chat", "threadId");
const NOW_MS = Date.parse("2026-10-28T12:10:00Z");
const REVIEW = "codewide.scenario.reviewPr";
const ADDRESS = "codewide.scenario.addressComments";
/** Progress words the row must never put in place of the plugin's label. */
const PROGRESS_WORDS = /Reviewing|Addressing|Starting|Running|Updating|…/u;

function catalog(addressAvailability: Record<string, unknown>): readonly ActionDescriptor[] {
  const descriptor = (actionId: string, kind: string, label: string, order: number) => ({
    actionId,
    anchor: { kind: "header" },
    availability: { state: "enabled" },
    confirm: "none",
    group: "agent",
    input: null,
    isDefault: false,
    kind,
    label,
    order,
    placement: "secondary",
    toggle: null,
  });
  const parsed = parseActionCatalog(
    {
      actions: [
        descriptor(REVIEW, "reviewPr", "Review PR", 1),
        {
          ...descriptor(ADDRESS, "addressComments", "Address comments", 2),
          availability: addressAvailability,
        },
      ],
      headRevision: HEAD,
    },
    () => undefined,
  );
  if (parsed === null) {
    throw new Error("the agent catalog fixture must parse");
  }
  return parsed.actions;
}

const ENABLED = { state: "enabled" };

/** Views from one `scenarios/read` result naming only the review slot. */
function reviewViews(
  actions: readonly ActionDescriptor[],
  state: Record<string, unknown>,
): ScenarioViews {
  const parsed = parsePullRequestScenarios({
    scenarios: [{ checkId: null, reviewThreadId: null, scenario: "reviewPr", state }],
  });
  if (parsed === null) {
    throw new Error("the scenarios fixture must parse");
  }
  return scenarioViews(actions, parsed, HEAD);
}

type Start = PullRequestDetailWorkspaceCapabilities["startScenario"];

/** The section wired to the screen's real scenario dispatcher and pending model. */
function renderSection(
  actions: readonly ActionDescriptor[],
  views: ScenarioViews,
  startScenario: Start,
) {
  const refused = async () => Promise.reject(new Error("not part of this test"));
  const capabilities: PullRequestDetailWorkspaceCapabilities = {
    createComment: refused,
    ensureReviewChat: refused,
    markAttentionSeen: refused,
    replyToReviewThread: refused,
    resolveReviewThread: refused,
    runAction: refused,
    setLink: refused,
    setViewed: refused,
    startScenario,
    submitReview: refused,
    transferAccess: refused,
  };
  const pullRequest = parsePullRequestKeyParam("fpr1.github-91");
  if (pullRequest === null) {
    throw new Error("the pull request key fixture must parse");
  }
  const model = createPullRequestScreenModel();
  const onOpenThread = jest.fn<undefined, [ThreadId]>();
  const onOpenChat = jest.fn<undefined, [ThreadId | null]>();
  const hook = renderHook(() =>
    usePullRequestActions({
      capabilities,
      model,
      onDeferScenario: async () => Promise.reject(new Error("a live review chat needs no draft")),
      onOpenThread,
      onRefresh: () => undefined,
      scenarioViews: views,
      target: { connectionId: "server", headRevision: HEAD, host: "github.com", pullRequest },
    }),
  );
  function Section(): React.JSX.Element {
    const pending = useSelector(() => model.pending.get());
    return (
      <ScenarioViewsContext.Provider value={views}>
        <AgentSection
          actions={actions}
          nowMs={NOW_MS}
          onOpenChat={onOpenChat}
          onRun={(action) => {
            hook.result.current.run(action, null);
          }}
          pending={pending}
        />
      </ScenarioViewsContext.Provider>
    );
  }
  render(<Section />);
  return { model, onOpenChat, onOpenThread };
}

function labelText(label: string) {
  return screen.UNSAFE_getAllByType(AppText).find((node) => node.props.children === label);
}

beforeEach(() => {
  resetAppDialog();
});

it("lists each idle agent action under the Agent label with its own Run button", async () => {
  const actions = catalog(ENABLED);
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>(async () =>
    Promise.resolve({ created: false, kind: "started", threadId: REVIEW_CHAT }),
  );
  const { onOpenThread } = renderSection(actions, new Map(), start);

  expect(screen.getByText("Agent")).toBeOnTheScreen();
  expect(screen.getByLabelText("Review PR, not started")).toBeOnTheScreen();
  expect(screen.getByLabelText("Address comments, not started")).toBeOnTheScreen();
  expect(labelText("Review PR")?.props.shimmering).toBe(false);

  fireEvent.press(screen.getByLabelText("Run Review PR"));

  await waitFor(() => {
    expect(onOpenThread.mock.calls).toEqual([[REVIEW_CHAT]]);
  });
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[1].scenario).toBe("reviewPr");
});

it("keeps a running review's label, shimmers it and opens its chat without starting another", () => {
  const actions = catalog(ENABLED);
  const views = reviewViews(actions, {
    headRevision: "head-2",
    startedAt: "2026-10-28T12:08:00Z",
    status: "running",
    threadId: REVIEW_CHAT,
  });
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>();
  const { onOpenChat } = renderSection(actions, views, start);

  const row = screen.getByTestId(`agent-action-${REVIEW}`);
  expect(row.props.accessibilityLabel).toBe("Review PR, running, opens the chat");
  expect(labelText("Review PR")?.props.shimmering).toBe(true);
  expect(screen.getByText("open chat")).toBeOnTheScreen();
  expect(screen.queryByText(PROGRESS_WORDS)).toBeNull();
  // A running row has no start control of its own.
  expect(screen.queryByTestId(`catalog-action-${REVIEW}`)).toBeNull();

  fireEvent.press(row);

  expect(onOpenChat.mock.calls).toEqual([[REVIEW_CHAT]]);
  expect(start).not.toHaveBeenCalled();
});

it("shows a failed run's real reason and starts it once again from Retry", async () => {
  const actions = catalog(ENABLED);
  const views = reviewViews(actions, {
    finishedAt: "2026-10-28T12:05:00Z",
    headRevision: "head-2",
    reason: "usage limit reached",
    status: "failed",
    threadId: REVIEW_CHAT,
  });
  let settle: (() => void) | null = null;
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>(
    async () =>
      new Promise((resolve) => {
        settle = () => {
          resolve({ created: false, kind: "started", threadId: REVIEW_CHAT });
        };
      }),
  );
  const { model, onOpenThread } = renderSection(actions, views, start);

  expect(screen.getByText("usage limit reached")).toBeOnTheScreen();
  expect(screen.getByTestId(`agent-action-${REVIEW}`).props.accessibilityLabel).toBe(
    "Review PR, failed: usage limit reached, opens the chat",
  );
  const retry = screen.getByLabelText("Retry Review PR");

  fireEvent.press(retry);
  fireEvent.press(screen.getByLabelText("Run Review PR"));

  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[1].scenario).toBe("reviewPr");
  expect(labelText("Review PR")?.props.shimmering).toBe(true);
  expect(screen.getByLabelText("Run Review PR")).toBeDisabled();

  await act(async () => {
    settle?.();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(model.pending.get()).toEqual({});
  });
  expect(onOpenThread.mock.calls).toEqual([[REVIEW_CHAT]]);
  expect(start).toHaveBeenCalledTimes(1);
});

it("shows a disabled action's reason on the row and accepts no press", () => {
  const actions = catalog({ reason: "No unresolved comments", state: "disabled" });
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>();
  const { onOpenChat } = renderSection(actions, new Map(), start);

  expect(screen.getByText("No unresolved comments")).toBeOnTheScreen();
  const row = screen.getByTestId(`agent-action-${ADDRESS}`);
  expect(row.props.accessibilityLabel).toBe(
    "Address comments, unavailable: No unresolved comments",
  );
  expect(row).toBeDisabled();
  const run = screen.getByLabelText("Run Address comments");
  expect(run).toBeDisabled();

  fireEvent.press(row);
  fireEvent.press(run);

  expect(start).not.toHaveBeenCalled();
  expect(onOpenChat).not.toHaveBeenCalled();
});
