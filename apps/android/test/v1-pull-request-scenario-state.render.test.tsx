import { useSelector } from "@legendapp/state/react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react-native";

import {
  parseActionCatalog,
  type ActionDescriptor,
} from "../src/data/forgeActionCatalog";
import {
  headRevision,
  parsePullRequestKeyParam,
} from "../src/data/forgeContract";
import { parsePullRequestScenarios } from "../src/data/forgeScenarioContract";
import { threadId, type ThreadId } from "../src/data/reviewContract";
import { CatalogActionButton } from "../src/features/pullRequestDetail/actions/CatalogActionButton";
import {
  scenarioFailure,
  scenarioViews,
  withScenarioLabels,
  type ScenarioViews,
} from "../src/features/pullRequestDetail/actions/scenarioRuns";
import { ScenarioViewsContext } from "../src/features/pullRequestDetail/actions/ScenarioViewsContext";
import { usePullRequestActions } from "../src/features/pullRequestDetail/actions/usePullRequestActions";
import { createPullRequestScreenModel } from "../src/features/pullRequestDetail/pullRequestScreenModel";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import { resetAppDialog } from "./mocks/AppDialog";

const HEAD = headRevision("head-2", "headRevision");
const REVIEW_CHAT = threadId("thread-review-chat", "threadId");
const NOW_MS = Date.parse("2026-10-28T12:10:00Z");
const REVIEW = "codewide.scenario.reviewPr";
const FIX = "codewide.scenario.fixCi";

function catalog(): readonly ActionDescriptor[] {
  const parsed = parseActionCatalog(
    {
      actions: [
        {
          actionId: REVIEW,
          anchor: { kind: "header" },
          availability: { state: "enabled" },
          confirm: "none",
          group: "agent",
          input: null,
          isDefault: false,
          kind: "reviewPr",
          label: "Review PR",
          order: 103,
          placement: "secondary",
          toggle: null,
        },
        {
          actionId: FIX,
          anchor: { checkId: "check-lint", kind: "checks" },
          availability: { state: "enabled" },
          confirm: "none",
          group: "agent",
          input: null,
          isDefault: true,
          kind: "fixCi",
          label: "Fix in agent",
          order: 100,
          placement: "secondary",
          toggle: null,
        },
      ],
      headRevision: HEAD,
    },
    () => undefined,
  );
  if (parsed === null) {
    throw new Error("the scenario catalog fixture must parse");
  }
  return parsed.actions;
}

function action(actionId: string): ActionDescriptor {
  const found = catalog().find((candidate) => candidate.actionId === actionId);
  if (found === undefined) {
    throw new Error(`the catalog fixture has ${actionId}`);
  }
  return found;
}

/** Views from one `scenarios/read` result naming only the review slot. */
function reviewViews(state: Record<string, unknown>): ScenarioViews {
  const parsed = parsePullRequestScenarios({
    scenarios: [
      { checkId: null, reviewThreadId: null, scenario: "reviewPr", state },
    ],
  });
  if (parsed === null) {
    throw new Error("the scenarios fixture must parse");
  }
  return scenarioViews(catalog(), parsed, HEAD);
}

function reviewLabel(views: ScenarioViews): string | undefined {
  return withScenarioLabels(catalog(), views, NOW_MS).find(
    (candidate) => candidate.actionId === REVIEW,
  )?.label;
}

type Start = PullRequestDetailWorkspaceCapabilities["startScenario"];

function renderActions(startScenario: Start, views: ScenarioViews) {
  const refused = async () =>
    Promise.reject(new Error("not part of this test"));
  const capabilities: PullRequestDetailWorkspaceCapabilities = {
    createComment: refused,
    ensureReviewChat: refused,
    markAttentionSeen: refused,
    replyToReviewThread: refused,
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
  const onOpenThread = jest.fn<undefined, [ThreadId]>();
  const model = createPullRequestScreenModel();
  const hook = renderHook(() =>
    usePullRequestActions({
      capabilities,
      model,
      onChooseWorkspace: async () =>
        Promise.reject(new Error("a live chat needs no choice")),
      onOpenThread,
      onRefresh: () => undefined,
      scenarioViews: views,
      target: {
        connectionId: "server",
        headRevision: HEAD,
        host: "github.com",
        pullRequest,
      },
    }),
  );
  return { hook, model, onOpenThread };
}

/** A start the test settles by hand, so the pending window stays observable. */
function deferredStart() {
  let settle: (() => void) | null = null;
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>(
    async () =>
      new Promise((resolve) => {
        settle = () => {
          resolve({ created: false, kind: "started", threadId: REVIEW_CHAT });
        };
      }),
  );
  return {
    settle: () => {
      settle?.();
    },
    start,
  };
}

beforeEach(() => {
  resetAppDialog();
});

it("labels each Companion scenario state for the shown head", () => {
  expect(reviewLabel(reviewViews({ status: "idle" }))).toBe("Review PR");
  expect(
    reviewLabel(
      reviewViews({
        headRevision: "head-2",
        queuedAt: "2026-10-28T12:09:00Z",
        status: "queued",
        threadId: REVIEW_CHAT,
      }),
    ),
  ).toBe("Reviewing…");
  expect(
    reviewLabel(
      reviewViews({
        headRevision: "head-1",
        startedAt: "2026-10-28T12:09:30Z",
        status: "running",
        threadId: REVIEW_CHAT,
      }),
    ),
  ).toBe("Reviewing…");
  expect(
    reviewLabel(
      reviewViews({
        finishedAt: "2026-10-28T12:05:00Z",
        headRevision: "head-2",
        status: "done",
        threadId: REVIEW_CHAT,
      }),
    ),
  ).toBe("Reviewed · 5m ago");
  expect(
    reviewLabel(
      reviewViews({
        finishedAt: "2026-10-28T12:05:00Z",
        headRevision: "head-1",
        status: "done",
        threadId: REVIEW_CHAT,
      }),
    ),
  ).toBe("Review PR");
  const failed = reviewViews({
    finishedAt: null,
    headRevision: "head-2",
    reason: "usage limit reached",
    status: "failed",
    threadId: REVIEW_CHAT,
  });
  expect(reviewLabel(failed)).toBe("Review PR");
  expect(scenarioFailure(catalog(), failed)).toEqual({
    label: "Review PR",
    reason: "usage limit reached",
  });
  // A slot for another check leaves the anchored Fix in agent action idle.
  const otherCheck = parsePullRequestScenarios({
    scenarios: [
      {
        checkId: "check-test",
        reviewThreadId: null,
        scenario: "fixCi",
        state: {
          headRevision: "head-2",
          startedAt: "2026-10-28T12:09:30Z",
          status: "running",
          threadId: REVIEW_CHAT,
        },
      },
    ],
  });
  expect(otherCheck).not.toBeNull();
  expect(scenarioViews(catalog(), otherCheck, HEAD).has(FIX)).toBe(false);
});

it("rejects a scenarios read that breaks the contract", () => {
  expect(
    parsePullRequestScenarios({
      scenarios: [
        {
          checkId: null,
          reviewThreadId: null,
          scenario: "reviewPr",
          state: { status: "done" },
        },
      ],
    }),
  ).toBeNull();
  expect(
    parsePullRequestScenarios({
      scenarios: [
        {
          checkId: null,
          reviewThreadId: null,
          scenario: "message",
          state: { status: "idle" },
        },
      ],
    }),
  ).toBeNull();
});

it("shimmers and disables the tapped button at once and sends one request for a double tap", async () => {
  const { settle, start } = deferredStart();
  const { hook, model } = renderActions(start, new Map());
  function Button(): React.JSX.Element {
    const pending = useSelector(() => model.pending.get());
    return (
      <CatalogActionButton
        action={action(REVIEW)}
        onPress={(pressed) => {
          hook.result.current.run(pressed, null);
        }}
        pending={pending[REVIEW] === true}
        variant="secondary"
      />
    );
  }
  render(<Button />);
  const button = screen.getByTestId(`catalog-action-${REVIEW}`);

  act(() => {
    hook.result.current.run(action(REVIEW), null);
    hook.result.current.run(action(REVIEW), null);
  });

  expect(button.props.accessibilityState).toEqual({
    busy: true,
    disabled: true,
  });
  expect(screen.getByText("Review PR")).toBeTruthy();
  expect(start).toHaveBeenCalledTimes(1);

  await act(async () => {
    settle();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(model.pending.get()).toEqual({});
  });
  expect(
    screen.getByTestId(`catalog-action-${REVIEW}`).props.accessibilityState,
  ).toEqual({
    busy: false,
    disabled: false,
  });
});

it("opens the running review's chat instead of starting another", () => {
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>();
  const views = reviewViews({
    headRevision: "head-2",
    startedAt: "2026-10-28T12:09:30Z",
    status: "running",
    threadId: REVIEW_CHAT,
  });
  const { hook, onOpenThread } = renderActions(start, views);

  act(() => {
    hook.result.current.run(action(REVIEW), null);
  });

  expect(start).not.toHaveBeenCalled();
  expect(onOpenThread.mock.calls).toEqual([[REVIEW_CHAT]]);
  render(
    <ScenarioViewsContext.Provider value={views}>
      <CatalogActionButton
        action={{ ...action(REVIEW), label: "Reviewing…" }}
        onPress={() => undefined}
        pending={false}
        variant="secondary"
      />
    </ScenarioViewsContext.Provider>,
  );
  const button = screen.getByTestId(`catalog-action-${REVIEW}`);
  expect(button.props.accessibilityState).toEqual({
    busy: true,
    disabled: false,
  });
  expect(screen.getByText("Reviewing…")).toBeTruthy();
});

it("runs a finished review again directly, without a confirmation", async () => {
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>(async () =>
    Promise.resolve({ created: false, kind: "started", threadId: REVIEW_CHAT }),
  );
  const views = reviewViews({
    finishedAt: "2026-10-28T12:05:00Z",
    headRevision: "head-2",
    status: "done",
    threadId: REVIEW_CHAT,
  });
  const { hook, onOpenThread } = renderActions(start, views);

  act(() => {
    hook.result.current.run(action(REVIEW), null);
  });

  await waitFor(() => {
    expect(onOpenThread.mock.calls).toEqual([[REVIEW_CHAT]]);
  });
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[1].scenario).toBe("reviewPr");
});
