import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import V1ThreadLayout from "../app/(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout";
import type { PullRequestBadge } from "../src/data/forgePullRequestContract";
import { createThreadResourcesModel } from "../src/data/thread-resources-model";
import type { ThreadResourcesValue } from "../src/data/workspace-resource-database";
import { ThreadResourceContextChips } from "../src/features/changes/ThreadResourceContextChips";
import { ComposerContextStrip } from "../src/features/composer/ComposerContextStrip";
import { ComposerPullRequestContextChip } from "../src/features/composer/ComposerPullRequestContextChip";
import { PullRequestConversationPane } from "../src/routeComposition/PullRequestConversationPane";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import {
  clearMockRoutes,
  mockRouterHistory,
  registerMockRoute,
  resetMockRouter,
  router,
} from "./mocks/ExpoRouter";

const mockDemand = jest.fn();

jest.mock("../src/data/forgeRuntime", () => {
  const { observable } = jest.requireActual("@legendapp/state");
  return {
    pullRequestLinkResources: {
      badges$: observable({}),
      demand: (...args: unknown[]) => mockDemand(...args),
    },
  };
});
jest.mock("../src/data/workspace-runtime", () => ({
  workspaceRuntime: { fileTransferController: null, native: null, voiceController: null },
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({ workspaceFeatures: {} }));
jest.mock("../src/features/workspace/WorkspaceConversationProviders", () => ({
  WorkspaceConversationProviders: ({ children }: { readonly children: React.ReactNode }) =>
    children,
}));
// The review chat pane mounts the canonical conversation; its composer strip is the chip under test.
jest.mock("../src/features/conversation/ConversationWorkspace", () => {
  const { ComposerPullRequestContextChip: MockChip } = jest.requireActual(
    "../src/features/composer/ComposerPullRequestContextChip",
  );
  const { Text: MockText, View: MockView } = jest.requireActual("react-native");
  return {
    ActiveWorkspaceConversation: () => (
      <MockView>
        <MockText testID="canonical-conversation">conversation</MockText>
        <MockChip />
      </MockView>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    browserFeedback: null,
    connections: [],
    list: { loadedThreadSummaries: [], scopedThreads: [], servers: [] },
    pendingRequests: [],
    recovery: {},
    runtime: null,
  }),
}));

const { pullRequestLinkResources } = jest.requireMock<{
  pullRequestLinkResources: {
    badges$: { set: (value: Record<string, readonly PullRequestBadge[]>) => void };
  };
}>("../src/data/forgeRuntime");

const THREAD_PATH = "/threads/[connectionId]/[threadId]";
const PULL_REQUEST_PATH = "/pulls/[connectionId]/[pullRequestKey]";

const GLYPH_ICON = { kind: "glyph", path: "M2 2L22 22", viewBox: "0 0 24 24" } as const;

function badge(pullRequest: string, number: string): PullRequestBadge {
  // WHY: PullRequestKey is a validated brand; these fixtures stand in for decoded badges.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const key = pullRequest as PullRequestBadge["pullRequest"];
  return { icon: GLYPH_ICON, number, pullRequest: key, state: "open" };
}

function linkThread(threadId: string, badges: readonly PullRequestBadge[]): void {
  act(() => {
    pullRequestLinkResources.badges$.set({ [`server\u0000${threadId}`]: badges });
  });
}

function ThreadScreen(): React.JSX.Element {
  return (
    <>
      <Text>Thread</Text>
      <ComposerPullRequestContextChip />
    </>
  );
}

function renderThreadRoute(threadId: string) {
  registerMockRoute(THREAD_PATH, ThreadScreen);
  resetMockRouter({ params: { connectionId: "server", threadId }, pathname: THREAD_PATH });
  return render(<V1ThreadLayout />);
}

/**
 * The review chat as the right pane beside the pull request the center pane shows, exactly as the
 * PR route declares both panes; the chip learns what is beside it only from that declaration.
 */
function renderReviewChatBeside(pullRequest: string) {
  // WHY: PullRequestKey is a validated brand; this fixture stands in for the PR route's key.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const key = pullRequest as PullRequestBadge["pullRequest"];
  return render(
    <WorkspaceCenterLayout
      active
      center={{
        capabilities: {},
        content: <Text>Pull request</Text>,
        label: "pull request",
        shows: { connectionId: "server", kind: "pullRequest", pullRequest: key },
        testID: "center",
      }}
      right={{
        capabilities: {},
        content: (
          <PullRequestConversationPane
            connectionId="server"
            // WHY: the PR route passes the ensured canonical thread id; this fixture stands in.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            threadId={"review" as Parameters<typeof PullRequestConversationPane>[0]["threadId"]}
          />
        ),
        label: "review chat",
        shows: { connectionId: "server", kind: "conversation", threadId: "review" },
        testID: "right",
      }}
      testID="pull-request-workspace"
    />,
  );
}

beforeEach(() => {
  mockDemand.mockClear();
  pullRequestLinkResources.badges$.set({});
});

afterEach(() => {
  clearMockRoutes();
  resetMockRouter();
});

it("shows the linked pull request in the Threads chat and opens its Details", () => {
  const view = renderThreadRoute("linked");
  expect(mockDemand).toHaveBeenCalledWith("server", "linked");
  expect(view.queryByTestId("composer-pull-request-chip")).toBeNull();

  linkThread("linked", [badge("fpr1.github-115", "115")]);

  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#115");
  expect(view.getByTestId("forge-icon-glyph", { includeHiddenElements: true })).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText("Open pull request #115"));

  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-115" },
    pathname: PULL_REQUEST_PATH,
  });
  view.unmount();
});

it("shows no chip for a thread without linked pull requests", () => {
  linkThread("unlinked", []);
  const view = renderThreadRoute("unlinked");

  expect(view.getByText("Thread")).toBeOnTheScreen();
  expect(view.queryByTestId("composer-pull-request-chip")).toBeNull();
  view.unmount();
});

it("labels several links with a count, opens the most relevant and offers the rest", () => {
  // The Companion orders a thread's links: canonical review chat first, then most recent.
  linkThread("several", [badge("fpr1.github-120", "120"), badge("fpr1.github-115", "115")]);
  const view = renderThreadRoute("several");

  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#120 +1");
  fireEvent(view.getByTestId("composer-pull-request-chip"), "longPress");
  fireEvent.press(view.getByLabelText("Choose linked pull request: Pull request #115"));
  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-115" },
    pathname: PULL_REQUEST_PATH,
  });

  act(() => {
    router.back();
  });
  fireEvent.press(view.getByTestId("composer-pull-request-chip"));
  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-120" },
    pathname: PULL_REQUEST_PATH,
  });
  view.unmount();
});

it("hides the chip in the review chat beside its own pull request", () => {
  linkThread("review", [badge("fpr1.github-91", "91")]);
  const view = renderReviewChatBeside("fpr1.github-91");

  expect(view.getByTestId("canonical-conversation")).toBeOnTheScreen();
  expect(view.queryByTestId("composer-pull-request-chip")).toBeNull();

  // A second PR linked to the same chat is not on screen, so the chip offers only that one.
  linkThread("review", [badge("fpr1.github-91", "91"), badge("fpr1.github-92", "92")]);
  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#92");
  view.unmount();
});

it("offers the review chat's own pull request on a phone, where the chat opens in Threads", () => {
  // A phone opens the canonical review chat through the Threads route, so its PR is off screen.
  linkThread("review", [badge("fpr1.github-91", "91")]);
  const view = renderThreadRoute("review");

  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#91");
  fireEvent.press(view.getByLabelText("Open pull request #91"));
  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-91" },
    pathname: PULL_REQUEST_PATH,
  });
  view.unmount();
});

it("orders the chip after the branch chip and before attachments, ahead of later chips", async () => {
  linkThread("strip", [badge("fpr1.github-7", "7")]);
  const model = createThreadResourcesModel();
  const load = async (): Promise<ThreadResourcesValue> => {
    const value: ThreadResourcesValue = {
      attachments: [],
      changeScope: "branch",
      changeScopes: ["branch"],
      changes: [],
      revision: "branch-r1",
      threadId: "strip",
    };
    model.put({
      connectionId: "server",
      error: null,
      id: "server\u0000strip",
      status: "ready",
      threadId: "strip",
      updatedAt: 1,
      value,
    });
    return value;
  };
  function StripScreen(): React.JSX.Element {
    return (
      <ComposerContextStrip
        applyModelSettings={jest.fn()}
        closeQuickControlMenu={jest.fn()}
        controlError={null}
        controls$={null}
        controlsResourceId={null}
        cwd="/workspace"
        newChat={false}
        openControls={jest.fn()}
        openQuickControlMenu={jest.fn()}
        readOnly={false}
        remoteThread={null}
        selectedEffort={null}
        selectedModel={null}
        selectedPermissions={null}
        selectedPersonality={null}
        selectedServiceTier={null}
        selectPermissions={jest.fn()}
        toolContextChips={
          <>
            <ThreadResourceContextChips
              afterChanges={<ComposerPullRequestContextChip />}
              load={load}
              model={model}
              onOpen={jest.fn()}
              onPreferencesChange={jest.fn()}
              preferences={{ mode: "unified", scope: "branch", wrapLines: false }}
              resourceId={"server\u0000strip"}
              revision="live"
            />
            <Text testID="subagents-chip">Subagents</Text>
          </>
        }
        workspaceResources={null}
      />
    );
  }
  registerMockRoute(THREAD_PATH, StripScreen);
  resetMockRouter({ params: { connectionId: "server", threadId: "strip" }, pathname: THREAD_PATH });
  const view = render(<V1ThreadLayout />);
  await waitFor(() => expect(view.getByTestId("composer-attachments-label")).toBeOnTheScreen());

  const order = view
    .getByTestId("composer-context-strip")
    .findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string")
    .map((node) => String(node.props.testID))
    .filter((id) =>
      [
        "composer-model-label",
        "composer-permissions-label",
        "composer-changes-label",
        "composer-pull-request-chip",
        "composer-attachments-label",
        "subagents-chip",
      ].includes(id),
    );
  expect(order.filter((id, index) => order.indexOf(id) === index)).toEqual([
    "composer-model-label",
    "composer-permissions-label",
    "composer-changes-label",
    "composer-pull-request-chip",
    "composer-attachments-label",
    "subagents-chip",
  ]);
  view.unmount();
});
