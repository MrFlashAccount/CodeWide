import { act, fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";

import V1ThreadLayout from "../app/(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout";
import V1ThreadRoute from "../app/(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/index";
import type { PullRequestBadge } from "../src/data/forgePullRequestContract";
import type { PullRequestDetailPaneProps } from "../src/routeComposition/PullRequestDetailPane";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import { useWorkspacePaneChrome } from "../src/routeComposition/workspacePanes";
import { PaneChromeControls } from "./fixtures/PaneChromeControls";
import {
  clearMockRoutes,
  mockRouterHistory,
  registerMockRoute,
  resetMockRouter,
} from "./mocks/ExpoRouter";

const mockPrepareThreadLink = jest.fn();
let mockDesktop = true;
let mockConversationMounts = 0;

jest.mock("../src/data/forgeRuntime", () => {
  const { observable } = jest.requireActual("@legendapp/state");
  return {
    pullRequestLinkResources: { badges$: observable({}), demand: () => undefined },
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
// The conversation records its own mount, so a replaced chat is visible; its strip holds the chip.
jest.mock("../src/features/conversation/ConversationWorkspace", () => {
  const { useState: useMockState } = jest.requireActual("react");
  const { ComposerPullRequestContextChip: MockChip } = jest.requireActual(
    "../src/features/composer/ComposerPullRequestContextChip",
  );
  const { Text: MockText, View: MockView } = jest.requireActual("react-native");
  return {
    ActiveWorkspaceConversation: () => {
      const [mount] = useMockState(() => {
        mockConversationMounts += 1;
        return mockConversationMounts;
      });
      return (
        <MockView>
          <MockText testID="thread-conversation">{`conversation mount ${mount}`}</MockText>
          <MockChip />
        </MockView>
      );
    },
  };
});
jest.mock("../src/routeComposition/PullRequestDetailPane", () => ({
  PullRequestDetailPane: (props: PullRequestDetailPaneProps) => <MockPullRequestPane {...props} />,
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    browserFeedback: null,
    connections: [{ id: "server" }],
    desktop: mockDesktop,
    list: {
      loadedThreadSummaries: [],
      prepareThreadLink: (key: string) => mockPrepareThreadLink(key),
      scopedThreads: [],
      servers: [],
    },
    pendingRequests: [],
    recovery: {},
    runtime: { threadSummaries: null },
    viewportWidth: 1600,
  }),
}));

const { pullRequestLinkResources } = jest.requireMock<{
  pullRequestLinkResources: {
    badges$: { set: (value: Record<string, readonly PullRequestBadge[]>) => void };
  };
}>("../src/data/forgeRuntime");

const THREAD_PATH = "/threads/[connectionId]/[threadId]";

/**
 * Stands in for the PR detail: it exposes the tab the pane owner selects and raises the same
 * navigation intents the real screen does, with Back following the screen's `backFor` rule.
 */
function MockPullRequestPane(props: PullRequestDetailPaneProps): React.JSX.Element {
  const chrome = useWorkspacePaneChrome();
  const back = props.tab === "changes" ? props.navigation.closeChanges : props.navigation.back;
  return (
    <View>
      <Text testID="pane-pull-request">{`${props.pullRequest} ${props.tab}`}</Text>
      {props.tab === "changes" ? (
        <Text testID="pane-changes-view">{props.initialChangesView}</Text>
      ) : null}
      <Pressable
        accessibilityLabel="Open review guide"
        onPress={() => {
          props.navigation.openChanges("guide");
        }}
      />
      {back === null ? null : <Pressable accessibilityLabel="Pane back" onPress={back} />}
      <Pressable
        accessibilityLabel="Open this review chat"
        onPress={() => {
          // WHY: the fixture names the mounted thread exactly as the screen's overview would.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          props.navigation.openReviewChat(
            "linked" as Parameters<typeof props.navigation.openThread>[0],
          );
        }}
      />
      <Pressable
        accessibilityLabel="Open other chat"
        onPress={() => {
          // WHY: the fixture names another thread exactly as the screen's overview would.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          props.navigation.openReviewChat(
            "other" as Parameters<typeof props.navigation.openThread>[0],
          );
        }}
      />
      <PaneChromeControls chrome={chrome} name="pull request" />
    </View>
  );
}

type BackListener = () => boolean | null | undefined;
let backListeners: BackListener[] = [];

function pressSystemBack(): boolean {
  let handled = false;
  act(() => {
    handled = backListeners.toReversed().some((listener) => listener() === true);
  });
  return handled;
}

function badge(pullRequest: string, number: string): PullRequestBadge {
  // WHY: PullRequestKey is a validated brand; these fixtures stand in for decoded badges.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const key = pullRequest as PullRequestBadge["pullRequest"];
  return { icon: null, number, pullRequest: key, state: "open" };
}

function Workspace(): React.JSX.Element {
  const [desktop] = useState(mockDesktop);
  return (
    <WorkspacePaneFrame
      catalog={null}
      catalogFocused={false}
      catalogStatus="present"
      desktop={desktop}
      detail={<V1ThreadLayout />}
      presentation={desktop ? { kind: "wide", viewportWidth: 1600 } : { kind: "stacked" }}
      viewportWidth={1600}
    />
  );
}

function renderThread(links: readonly PullRequestBadge[]) {
  registerMockRoute(THREAD_PATH, V1ThreadRoute);
  resetMockRouter({
    params: { connectionId: "server", threadId: "linked" },
    pathname: THREAD_PATH,
  });
  pullRequestLinkResources.badges$.set({ "server\u0000linked": links });
  return render(<Workspace />);
}

function currentRoute() {
  return mockRouterHistory().at(-1);
}

beforeEach(() => {
  backListeners = [];
  mockConversationMounts = 0;
  mockDesktop = true;
  mockPrepareThreadLink.mockClear();
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    backListeners.push(listener);
    return {
      remove: () => {
        backListeners = backListeners.filter((candidate) => candidate !== listener);
      },
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearMockRoutes();
  resetMockRouter();
});

it("opens the linked pull request beside the chat without leaving the thread", () => {
  const view = renderThread([badge("fpr1.github-115", "115"), badge("fpr1.github-120", "120")]);
  expect(view.queryByTestId("thread-pull-request-pane")).toBeNull();
  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#115 +1");

  fireEvent.press(view.getByTestId("composer-pull-request-chip"));

  // The thread route stays the only history entry; the pane is its search param.
  expect(mockRouterHistory()).toHaveLength(1);
  expect(currentRoute()).toEqual({
    params: { connectionId: "server", pullRequest: "fpr1.github-115", threadId: "linked" },
    pathname: THREAD_PATH,
  });
  expect(view.getByTestId("thread-pull-request-pane")).toBeOnTheScreen();
  expect(view.getByTestId("pane-pull-request")).toHaveTextContent("fpr1.github-115 overview");
  // The chat stays mounted and reachable beside the pane, and stops offering the shown PR.
  expect(view.getByTestId("thread-conversation")).toHaveTextContent("conversation mount 1");
  expect(view.getByTestId("thread-primary-pane")).not.toHaveProp(
    "importantForAccessibility",
    "no-hide-descendants",
  );
  expect(view.getByTestId("composer-pull-request-label")).toHaveTextContent("#120");
  // Beside the chat the pane can close and go fullscreen.
  expect(view.getByLabelText("pull request menu: Fullscreen")).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText("Close pull request"));
  expect(view.queryByTestId("thread-pull-request-pane")).toBeNull();
  expect(currentRoute()?.params).toEqual({ connectionId: "server", threadId: "linked" });
  expect(view.getByTestId("thread-conversation")).toHaveTextContent("conversation mount 1");
  view.unmount();
});

it("steps Back from Changes to Details, then closes the pane, then yields to the thread", () => {
  mockDesktop = false;
  const view = renderThread([badge("fpr1.github-91", "91")]);
  fireEvent.press(view.getByTestId("composer-pull-request-chip"));

  // A phone covers the chat with the pane, keeping the chat mounted beneath it.
  expect(view.getByTestId("thread-compact-pull-request")).toBeOnTheScreen();
  expect(view.getByTestId("thread-primary-pane", { includeHiddenElements: true })).toHaveProp(
    "importantForAccessibility",
    "no-hide-descendants",
  );

  fireEvent.press(view.getByLabelText("Open review guide"));
  expect(view.getByTestId("pane-pull-request")).toHaveTextContent("fpr1.github-91 changes");
  expect(view.getByTestId("pane-changes-view")).toHaveTextContent("guide");

  expect(pressSystemBack()).toBe(true);
  expect(view.getByTestId("pane-pull-request")).toHaveTextContent("fpr1.github-91 overview");
  expect(currentRoute()?.params).toEqual({
    connectionId: "server",
    pullRequest: "fpr1.github-91",
    threadId: "linked",
  });

  expect(pressSystemBack()).toBe(true);
  expect(view.queryByTestId("thread-compact-pull-request")).toBeNull();
  expect(currentRoute()?.params).toEqual({ connectionId: "server", threadId: "linked" });
  expect(
    view.getByTestId("thread-conversation", { includeHiddenElements: true }),
  ).toHaveTextContent("conversation mount 1");

  // With the pane closed nothing below the router claims Back, so the thread's own Back runs.
  expect(pressSystemBack()).toBe(false);
  view.unmount();
});

it("steps back in the pane through the PR's own Back controls", () => {
  mockDesktop = false;
  const view = renderThread([badge("fpr1.github-91", "91")]);
  fireEvent.press(view.getByTestId("composer-pull-request-chip"));
  fireEvent.press(view.getByLabelText("Open review guide"));

  fireEvent.press(view.getByLabelText("Pane back"));
  expect(view.getByTestId("pane-pull-request")).toHaveTextContent("fpr1.github-91 overview");
  fireEvent.press(view.getByLabelText("Pane back"));
  expect(view.queryByTestId("thread-compact-pull-request")).toBeNull();
  expect(mockRouterHistory()).toHaveLength(1);
  view.unmount();
});

it("closes the pane for this thread's review chat and navigates to another chat", () => {
  const view = renderThread([badge("fpr1.github-91", "91")]);
  fireEvent.press(view.getByTestId("composer-pull-request-chip"));

  fireEvent.press(view.getByLabelText("Open this review chat"));
  expect(view.queryByTestId("thread-pull-request-pane")).toBeNull();
  expect(mockRouterHistory()).toHaveLength(1);

  fireEvent.press(view.getByTestId("composer-pull-request-chip"));
  fireEvent.press(view.getByLabelText("Open other chat"));
  expect(mockPrepareThreadLink).toHaveBeenCalledTimes(1);
  expect(currentRoute()).toEqual({
    params: { connectionId: "server", threadId: "other" },
    pathname: THREAD_PATH,
  });
  view.unmount();
});
