import { act, renderHook, waitFor } from "@testing-library/react-native";

import { parseActionCatalog } from "../src/data/forgeActionCatalog";
import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { threadId, type ThreadId } from "../src/data/reviewContract";
import { usePullRequestActions } from "../src/features/pullRequestDetail/actions/usePullRequestActions";
import { createPullRequestScreenModel } from "../src/features/pullRequestDetail/pullRequestScreenModel";
import type { DeferReviewChatScenario } from "../src/features/pullRequestDetail/pullRequestScreenContract";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const canonicalThread = threadId("thread-review-chat", "threadId");

function catalog() {
  const parsed = parseActionCatalog(
    {
      actions: [
        {
          actionId: "codewide.scenario.reviewPr",
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
          actionId: "codewide.scenario.fixCi",
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
      headRevision: "head-1",
    },
    () => undefined,
  );
  if (parsed === null) {
    throw new Error("the scenario catalog fixture must parse");
  }
  return parsed;
}

const neverDeferred: DeferReviewChatScenario = async () =>
  Promise.reject(new Error("a live review chat needs no draft"));

function renderActions(
  startScenario: PullRequestDetailWorkspaceCapabilities["startScenario"],
  deferScenario: DeferReviewChatScenario = neverDeferred,
) {
  const refused = () => Promise.reject(new Error("not part of this test"));
  const capabilities: PullRequestDetailWorkspaceCapabilities = {
    ensureReviewChat: refused,
    markAttentionSeen: refused,
    runAction: refused,
    setLink: refused,
    setViewed: refused,
    startScenario,
    submitReview: refused,
  };
  const pullRequest = parsePullRequestKeyParam("fpr1.github-91");
  const { actions, headRevision } = catalog();
  if (pullRequest === null) {
    throw new Error("the pull request key fixture must parse");
  }
  const onOpenThread = jest.fn<undefined, [ThreadId]>();
  const model = createPullRequestScreenModel();
  const hook = renderHook(() =>
    usePullRequestActions({
      capabilities,
      model,
      onDeferScenario: deferScenario,
      onOpenThread,
      onRefresh: () => undefined,
      scenarioViews: new Map(),
      target: {
        connectionId: "server",
        headRevision,
        host: "github.com",
        pullRequest,
      },
    }),
  );
  return { actions, hook, model, onOpenThread };
}

beforeEach(() => {
  resetAppDialog();
});

it("starts every agent scenario in the PR review chat and opens the thread the companion chose", async () => {
  const startScenario = jest.fn<
    ReturnType<PullRequestDetailWorkspaceCapabilities["startScenario"]>,
    Parameters<PullRequestDetailWorkspaceCapabilities["startScenario"]>
  >(() =>
    Promise.resolve({
      created: false,
      kind: "started",
      threadId: canonicalThread,
    }),
  );
  const { actions, hook, model, onOpenThread } = renderActions(startScenario);

  for (const action of actions) {
    act(() => {
      hook.result.current.run(action, null);
    });
  }

  await waitFor(() => {
    expect(onOpenThread).toHaveBeenCalledTimes(actions.length);
  });
  expect(startScenario.mock.calls.map(([, request]) => request.target)).toEqual([
    { kind: "reviewChat", workspace: { kind: "ask" } },
    { kind: "reviewChat", workspace: { kind: "ask" } },
  ]);
  expect(
    startScenario.mock.calls.map(([, request]) => [request.scenario, request.checkId]),
  ).toEqual([
    ["reviewPr", null],
    ["fixCi", "check-lint"],
  ]);
  expect(onOpenThread.mock.calls).toEqual([[canonicalThread], [canonicalThread]]);
  expect(getAppDialogRequest()).toBeNull();
  expect(model.pending.get()).toEqual({});
});

it("reports a refused start without opening any thread", async () => {
  const startScenario = jest.fn<
    ReturnType<PullRequestDetailWorkspaceCapabilities["startScenario"]>,
    Parameters<PullRequestDetailWorkspaceCapabilities["startScenario"]>
  >(() => Promise.reject(new Error("agents are unavailable on this companion")));
  const { actions, hook, model, onOpenThread } = renderActions(startScenario);
  const [reviewPr] = actions;
  if (reviewPr === undefined) {
    throw new Error("the catalog fixture has a review action");
  }

  act(() => {
    hook.result.current.run(reviewPr, null);
  });

  await waitFor(() => {
    expect(getAppDialogRequest()?.title).toBe("Could not start the agent");
  });
  expect(onOpenThread).not.toHaveBeenCalled();
  expect(model.pending.get()).toEqual({});
});

type StartScenario = PullRequestDetailWorkspaceCapabilities["startScenario"];

function firstAction(actions: ReturnType<typeof catalog>["actions"]) {
  const [action] = actions;
  if (action === undefined) {
    throw new Error("the catalog fixture has a review action");
  }
  return action;
}

it("defers a scenario without a review chat to the draft, then starts it in the confirmed project", async () => {
  const startScenario = jest.fn<ReturnType<StartScenario>, Parameters<StartScenario>>(
    async (_target, request) =>
      Promise.resolve(
        request.target.workspace.kind === "ask"
          ? {
              candidates: [
                { path: "/work/widget-pr", reason: "pullRequestBranch" },
                { path: "/work/widget", reason: "repository" },
              ],
              kind: "needsWorkspace",
            }
          : { created: true, kind: "started", threadId: canonicalThread },
      ),
  );
  const offered: unknown[] = [];
  const defer: DeferReviewChatScenario = async ({ candidates, label, start }) => {
    offered.push({ candidates, label });
    return start("/work/widget-pr");
  };
  const { actions, hook, model, onOpenThread } = renderActions(startScenario, defer);

  act(() => {
    hook.result.current.run(firstAction(actions), null);
  });

  await waitFor(() => {
    expect(onOpenThread).toHaveBeenCalledWith(canonicalThread);
  });
  expect(offered).toEqual([
    {
      candidates: [
        { path: "/work/widget-pr", reason: "pullRequestBranch" },
        { path: "/work/widget", reason: "repository" },
      ],
      label: firstAction(actions).label,
    },
  ]);
  const requests = startScenario.mock.calls.map(([, request]) => request);
  expect(requests.map((request) => request.target.workspace)).toEqual([
    { kind: "ask" },
    { kind: "path", path: "/work/widget-pr" },
  ]);
  // The asking start journals nothing, so the confirmed start is a new intent with its own key.
  expect(requests[0]?.idempotencyKey).not.toBe(requests[1]?.idempotencyKey);
  expect(getAppDialogRequest()).toBeNull();
  expect(model.pending.get()).toEqual({});
});

it("leaves everything unchanged when the review-chat draft is dismissed", async () => {
  const startScenario = jest.fn<ReturnType<StartScenario>, Parameters<StartScenario>>(async () =>
    Promise.resolve({ candidates: [], kind: "needsWorkspace" }),
  );
  const defer = jest.fn<ReturnType<DeferReviewChatScenario>, Parameters<DeferReviewChatScenario>>(
    async () => Promise.resolve(null),
  );
  const { actions, hook, model, onOpenThread } = renderActions(startScenario, defer);

  act(() => {
    hook.result.current.run(firstAction(actions), null);
  });

  await waitFor(() => {
    expect(model.pending.get()).toEqual({});
  });
  expect(defer).toHaveBeenCalledTimes(1);
  expect(defer.mock.calls[0]?.[0].candidates).toEqual([]);
  expect(startScenario).toHaveBeenCalledTimes(1);
  expect(onOpenThread).not.toHaveBeenCalled();
  expect(getAppDialogRequest()).toBeNull();
});
