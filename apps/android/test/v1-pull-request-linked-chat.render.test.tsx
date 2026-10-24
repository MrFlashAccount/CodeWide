import { fireEvent, render } from "@testing-library/react-native";

import { PullRequestRoute } from "../src/routeComposition/PullRequestRoute";

const mockSelectThread = jest.fn();
const mockSetDetailExpanded = jest.fn();
const mockPresent = jest.fn();
let mockDesktop = true;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ connectionId: "server", pullRequestKey: "fpr1.github-91" }),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  pullRequestCommentDestinations: {},
  reviewResources: {},
}));
jest.mock("../src/features/pullRequestDetail/PullRequestScreen", () => {
  const { Pressable: MockPressable, Text: MockText } = jest.requireActual("react-native");
  return {
    PullRequestScreen: ({
      navigation,
    }: {
      readonly navigation: {
        readonly beginChat: () => void;
        readonly openThread: (threadId: string) => void;
      };
    }) => (
      <>
        <MockPressable
          onPress={() => {
            navigation.openThread("linked-thread");
          }}
          testID="open-linked-thread"
        >
          <MockText>Open linked thread</MockText>
        </MockPressable>
        <MockPressable onPress={navigation.beginChat} testID="begin-linked-chat">
          <MockText>Begin linked chat</MockText>
        </MockPressable>
      </>
    ),
  };
});
jest.mock("../src/features/pullRequestDetail/PullRequestScreenSkeleton", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { PullRequestScreenSkeleton: () => <MockText>Loading pull request</MockText> };
});
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: { pullRequestDetail: {}, reviewTarget: {} },
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/routeComposition/pullRequestNavigation", () => ({
  linkedThreadSelectionKey: (connectionId: string, threadId: string) =>
    `${connectionId}:${threadId}`,
}));
jest.mock("../src/routeComposition/PullRequestConversationPane", () => {
  const { Text: MockText, View: MockView } = jest.requireActual("react-native");
  return {
    PullRequestConversationPane: ({
      headerActions,
      threadId,
    }: {
      readonly headerActions?: React.ReactNode;
      readonly threadId: string;
    }) => (
      <MockView>
        <MockText testID="canonical-conversation">{threadId}</MockText>
        {headerActions}
      </MockView>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    list: { loadedThreadSummaries: [], selectThread: mockSelectThread },
    viewportWidth: 1024,
  }),
}));
jest.mock("../src/routeComposition/workspacePaneController", () => ({
  useWorkspacePaneController: () => ({ setDetailExpanded: mockSetDetailExpanded }),
}));
jest.mock("../src/ui/AppFullscreenOverlay", () => ({
  useAppFullscreenOverlay: () => ({ present: mockPresent }),
}));
jest.mock("../src/ui/RecoverableRenderBoundary", () => ({
  RecoverableRenderBoundary: ({ children }: { readonly children: React.ReactNode }) => children,
}));

beforeEach(() => {
  mockDesktop = true;
  mockSelectThread.mockClear();
  mockSetDetailExpanded.mockClear();
  mockPresent.mockClear();
});

it("reveals the chat skeleton immediately while the canonical thread resolves", () => {
  const view = render(<PullRequestRoute />);

  fireEvent.press(view.getByTestId("begin-linked-chat"));

  expect(view.getByTestId("pull-request-chat-opening")).toBeVisible();
  expect(mockSetDetailExpanded).toHaveBeenCalledWith(true);
});

it("mounts the canonical conversation for the linked thread in the wide PR sidebar", () => {
  const view = render(<PullRequestRoute />);

  fireEvent.press(view.getByTestId("open-linked-thread"));

  expect(view.getByTestId("canonical-conversation")).toHaveTextContent("linked-thread");
  expect(mockSelectThread).not.toHaveBeenCalled();
});

it("exposes width, fullscreen and close controls in the canonical chat header", () => {
  const view = render(<PullRequestRoute />);

  fireEvent.press(view.getByTestId("open-linked-thread"));
  fireEvent.press(view.getByLabelText("Widen review chat"));

  expect(view.getByLabelText("Narrow review chat")).toBeVisible();
  fireEvent.press(view.getByLabelText("Open review chat fullscreen"));
  expect(mockPresent).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText("Close review chat"));
  expect(view.queryByTestId("canonical-conversation")).toBeNull();
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(false);
});

it("shows a full-surface opening state immediately on compact screens", () => {
  mockDesktop = false;
  const view = render(<PullRequestRoute />);

  fireEvent.press(view.getByTestId("begin-linked-chat"));

  expect(view.getByTestId("pull-request-chat-opening")).toBeVisible();
});

it("uses ordinary thread navigation instead of a second chat surface on compact screens", () => {
  mockDesktop = false;
  const view = render(<PullRequestRoute />);

  fireEvent.press(view.getByTestId("open-linked-thread"));

  expect(view.queryByTestId("canonical-conversation")).toBeNull();
  expect(mockSelectThread).toHaveBeenCalledWith("server:linked-thread");
});
