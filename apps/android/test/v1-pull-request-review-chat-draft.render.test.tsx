import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { DraftAdmission } from "../src/features/conversation/ConversationWorkspace.types";
import { NewChatProjectPicker } from "../src/features/projects/NewChatProjectPicker";
import { PullRequestRoute } from "../src/routeComposition/PullRequestRoute";
import { AppListRow } from "../src/ui/AppListRow";
import { routeScreenScenario } from "./fixtures/PullRequestRouteScreen";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const mockEnsureReviewChat = jest.fn();
const mockSendText = jest.fn();

// WHY: The native Compose sheet and list hosts are unavailable in Node; picker behavior stays real.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView,
  } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const Slot = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ListItem = Object.assign(Slot, {
    HeadlineContent: Slot,
    LeadingContent: Slot,
    SupportingContent: Slot,
    TrailingContent: Slot,
  });
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    { children }: { readonly children?: ReactNode },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    return <NativeView>{children}</NativeView>;
  });
  return {
    Box: Slot,
    CircularProgressIndicator: Slot,
    Host,
    Icon: Slot,
    ListItem,
    ModalBottomSheet,
    NativePressable,
    RNHostView: Host,
    Row: Slot,
    Text: NativeText,
  };
});
// WHY: Non-Android resolution still requires the external community sheet to be inert in Node.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View: NativeView, ScrollView } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <NativeView>{children}</NativeView>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: NativeView,
  };
});
jest.mock("expo-router", () => ({
  useIsFocused: () => true,
  useLocalSearchParams: () => ({ connectionId: "server", pullRequestKey: "fpr1.github-91" }),
  useRouter: () => ({ dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  pullRequestCommentDestinations: {},
  reviewResources: {},
}));
jest.mock("../src/data/workspace-runtime", () => ({ workspaceRuntime: { native: false } }));
jest.mock("../src/features/pullRequestDetail/PullRequestScreen", () =>
  jest.requireActual("./fixtures/PullRequestRouteScreen"),
);
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    composer: { sendText: (...args: unknown[]) => mockSendText(...args) },
    projects: {
      addProject: async () => Promise.reject(new Error("not part of this test")),
      listProjects: async () => Promise.resolve([]),
      readDirectory: async () => Promise.resolve([]),
      readProjectHome: async () => Promise.resolve("/home/me"),
    },
    pullRequestDetail: {
      ensureReviewChat: (...args: unknown[]) => mockEnsureReviewChat(...args),
    },
    reviewTarget: {},
  },
}));
jest.mock("../src/features/workspace/WorkspaceConversationProviders", () => ({
  WorkspaceConversationProviders: ({ children }: { readonly children: ReactNode }) => children,
}));
// WHY: the shared conversation surface has its own coverage; this double renders exactly what
// the route hands it: the hosted draft, its project picker, its send and its notice.
jest.mock("../src/features/conversation/ConversationWorkspace", () => ({
  ActiveWorkspaceConversation: ({
    destination,
    onClose,
  }: {
    readonly onClose: () => void;
    readonly destination:
      | { readonly kind: "thread" }
      | {
          readonly admission: DraftAdmission;
          readonly draft: { readonly cwd: string | null; readonly id: string };
          readonly kind: "draft";
        };
  }) =>
    destination.kind !== "draft" || destination.admission.kind !== "hosted" ? null : (
      <MockHostedDraft
        admission={destination.admission}
        cwd={destination.draft.cwd}
        onClose={onClose}
      />
    ),
}));
// WHY: the project catalog's resource lifecycle has dedicated coverage; one known project suffices.
jest.mock("../src/features/projects/useRemoteProjectCatalog", () => ({
  useRemoteProjectCatalog: () => ({
    errorsByConnection: {},
    mergeProject: () => undefined,
    projectsByConnection: {
      server: [{ addedAt: 1, lastUsedAt: 1, name: "notes", path: "/work/notes", pinned: true }],
    },
  }),
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/routeComposition/pullRequestNavigation", () => ({
  linkedThreadSelectionKey: (connectionId: string, threadId: string) =>
    `${connectionId}:${threadId}`,
  usePullRequestNavigation: () => ({ navigateToLinkedThread: jest.fn() }),
}));
jest.mock("../src/routeComposition/PullRequestConversationPane", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    PullRequestConversationPane: ({ threadId }: { readonly threadId: string }) => (
      <MockText testID="canonical-conversation">{threadId}</MockText>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    browserFeedback: null,
    connections: [],
    desktop: true,
    list: {
      listState: { setThreadListMode: () => undefined },
      loadedThreadSummaries: [],
      prepareThreadLink: () => undefined,
      scopedThreads: [],
      selectThread: () => undefined,
      servers: [{ iconId: "desktop", id: "server", name: "Studio", status: "live" }],
    },
    openBrowser: () => undefined,
    pendingRequests: [],
    recovery: { createUnsupportedFixThread: async () => Promise.resolve() },
    runtime: { threadSummaries: null },
    viewportWidth: 1600,
  }),
}));
jest.mock("../src/ui/RecoverableRenderBoundary", () => ({
  RecoverableRenderBoundary: ({ children }: { readonly children: React.ReactNode }) => children,
}));

/** The hosted draft as the conversation receives it, with the real shared project picker. */
function MockHostedDraft({
  admission,
  cwd,
  onClose,
}: {
  readonly admission: Extract<DraftAdmission, { readonly kind: "hosted" }>;
  readonly cwd: string | null;
  readonly onClose: () => void;
}): React.JSX.Element {
  const send = admission.send;
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <View testID="hosted-draft">
      <Pressable
        accessibilityLabel="Close review chat"
        accessibilityRole="button"
        onPress={onClose}
      >
        <Text>Close</Text>
      </Pressable>
      <Text testID="draft-project">{cwd ?? "no project"}</Text>
      <Text testID="draft-suggesting">{admission.suggesting ? "suggesting" : "settled"}</Text>
      <Pressable
        accessibilityLabel="Send first message"
        accessibilityRole="button"
        accessibilityState={{ disabled: send === null }}
        disabled={send === null}
        onPress={() => {
          send?.("Please look at the flaky test", { type: "start" }, { model: "gpt-5" }).catch(
            () => undefined,
          );
        }}
      >
        <Text>Send</Text>
      </Pressable>
      {admission.notice}
      <Pressable
        accessibilityLabel="Choose project"
        accessibilityRole="button"
        onPress={() => {
          setPickerOpen(true);
        }}
      >
        <Text>Choose project</Text>
      </Pressable>
      {pickerOpen ? (
        <NewChatProjectPicker
          {...admission.picker}
          onClose={() => {
            setPickerOpen(false);
          }}
          onSelect={async (destination) => {
            await admission.picker.onSelect(destination);
            setPickerOpen(false);
          }}
          visible
        />
      ) : null}
    </View>
  );
}

function selectedRowTitles(view: ReturnType<typeof render>): string[] {
  return view
    .UNSAFE_getAllByType(AppListRow)
    .filter((row) => row.props.selected === true)
    .map((row) => String(row.props.title));
}

const suggested = {
  candidates: [
    { path: "/work/widget-pr", reason: "pullRequestBranch" },
    { path: "/work/widget", reason: "repository" },
  ],
  kind: "needsWorkspace",
};

beforeEach(() => {
  resetAppDialog();
  mockEnsureReviewChat.mockReset();
  mockSendText.mockReset();
  routeScreenScenario.request = null;
  routeScreenScenario.result = null;
});

it("shows the new-chat draft at once, with no opening skeleton and no project sheet", () => {
  mockEnsureReviewChat.mockImplementation(() => new Promise(() => undefined));
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(view.getByTestId("draft-project")).toHaveTextContent("no project");
  expect(view.getByTestId("draft-suggesting")).toHaveTextContent("suggesting");
  // The only project control is the draft's own; no separate project sheet opened by itself.
  expect(view.UNSAFE_queryAllByType(NewChatProjectPicker)).toHaveLength(0);
  expect(view.getByLabelText("Send first message")).toBeDisabled();
});

it("pre-selects the Companion's first suggestion and lists suggestions first", async () => {
  mockEnsureReviewChat.mockResolvedValue(suggested);
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));

  await waitFor(() => {
    expect(view.getByTestId("draft-project")).toHaveTextContent("/work/widget-pr");
  });
  expect(view.getByTestId("draft-suggesting")).toHaveTextContent("settled");
  fireEvent.press(view.getByLabelText("Choose project"));
  expect(view.getByText("Suggested")).toBeVisible();
  expect(view.getByText("Has the PR branch · Studio · /work/widget-pr")).toBeVisible();
  expect(view.getByText("Same repository · Studio · /work/widget")).toBeVisible();
  expect(selectedRowTitles(view)).toEqual(["widget-pr"]);
  // The review chat has no server default the agent would silently pick.
  expect(view.queryByText("Server default")).toBeNull();
  expect(view.getByLabelText("Send first message")).toBeEnabled();
});

it("selects nothing and keeps send disabled when nothing is suggested", async () => {
  mockEnsureReviewChat.mockResolvedValue({ candidates: [], kind: "needsWorkspace" });
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));

  await waitFor(() => {
    expect(view.getByTestId("draft-suggesting")).toHaveTextContent("settled");
  });
  expect(view.getByTestId("draft-project")).toHaveTextContent("no project");
  fireEvent.press(view.getByLabelText("Choose project"));
  expect(view.queryByText("Suggested")).toBeNull();
  expect(selectedRowTitles(view)).toEqual([]);
  expect(view.getByLabelText("Send first message")).toBeDisabled();

  fireEvent.press(view.getByText("notes"));
  fireEvent.press(view.getByLabelText("Use this project"));

  await waitFor(() => {
    expect(view.getByTestId("draft-project")).toHaveTextContent("/work/notes");
  });
  expect(view.getByLabelText("Send first message")).toBeEnabled();
});

it("creates the chat in the chosen project on the first send, delivers the message and opens it", async () => {
  mockEnsureReviewChat.mockImplementation(
    async (_target: unknown, workspace: { readonly kind: string }) =>
      workspace.kind === "ask" ? suggested : { created: true, kind: "ready", threadId: "created" },
  );
  mockSendText.mockResolvedValue("command-1");
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("open-review-chat"));
  await waitFor(() => {
    expect(view.getByLabelText("Send first message")).toBeEnabled();
  });

  fireEvent.press(view.getByLabelText("Send first message"));

  await waitFor(() => {
    expect(view.getByTestId("canonical-conversation")).toHaveTextContent("created");
  });
  expect(mockEnsureReviewChat.mock.calls.map(([target, workspace]) => [target, workspace])).toEqual(
    [
      [{ connectionId: "server", pullRequest: "fpr1.github-91" }, { kind: "ask" }],
      [
        { connectionId: "server", pullRequest: "fpr1.github-91" },
        { kind: "path", path: "/work/widget-pr" },
      ],
    ],
  );
  expect(mockSendText).toHaveBeenCalledWith(
    "server",
    "created",
    "Please look at the flaky test",
    { type: "start" },
    { model: "gpt-5" },
  );
  expect(view.queryByTestId("pull-request-chat-draft")).toBeNull();
});

it("opens an existing chat directly, without a draft or a suggestion request", () => {
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-existing-review-chat"));

  expect(view.getByTestId("canonical-conversation")).toHaveTextContent("existing-thread");
  expect(view.queryByTestId("pull-request-chat-draft")).toBeNull();
  expect(mockEnsureReviewChat).not.toHaveBeenCalled();
});

it("holds a scenario without a chat in the draft and starts it in the confirmed project", async () => {
  const start = jest.fn(async (_path: string) => Promise.resolve("scenario-thread"));
  routeScreenScenario.request = {
    candidates: [{ path: "/work/widget-pr", reason: "pullRequestBranch" }],
    label: "Review PR",
    start,
  };
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("defer-review-scenario"));

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(view.getByText("Review PR will start in this chat")).toBeVisible();
  expect(view.getByTestId("draft-project")).toHaveTextContent("/work/widget-pr");
  expect(start).not.toHaveBeenCalled();
  expect(mockEnsureReviewChat).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(view.getByLabelText("Start Review PR"));
    await routeScreenScenario.result;
  });

  expect(start).toHaveBeenCalledWith("/work/widget-pr");
  await expect(routeScreenScenario.result).resolves.toBe("scenario-thread");
});

it("keeps a scenario's start disabled until a project is chosen, and keeps a refusal in the draft", async () => {
  const start = jest
    .fn(async (_path: string) => Promise.resolve("scenario-thread"))
    .mockRejectedValueOnce(new Error("the workspace is not a project or a known thread directory"));
  routeScreenScenario.request = { candidates: [], label: "Address comments", start };
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("defer-review-scenario"));

  expect(view.getByLabelText("Start Address comments")).toBeDisabled();
  fireEvent.press(view.getByLabelText("Choose project"));
  fireEvent.press(view.getByText("notes"));
  fireEvent.press(view.getByLabelText("Use this project"));
  await waitFor(() => {
    expect(view.getByLabelText("Start Address comments")).toBeEnabled();
  });

  await act(async () => {
    fireEvent.press(view.getByLabelText("Start Address comments"));
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(
      view.getByText("the workspace is not a project or a known thread directory"),
    ).toBeVisible();
  });
  // The chosen project stays selected for the retry.
  expect(view.getByTestId("draft-project")).toHaveTextContent("/work/notes");

  await act(async () => {
    fireEvent.press(view.getByLabelText("Start Address comments"));
    await routeScreenScenario.result;
  });
  expect(start.mock.calls).toEqual([["/work/notes"], ["/work/notes"]]);
  await expect(routeScreenScenario.result).resolves.toBe("scenario-thread");
});

it("discards a waiting scenario when the draft closes", async () => {
  const start = jest.fn(async (_path: string) => Promise.resolve("scenario-thread"));
  routeScreenScenario.request = {
    candidates: [{ path: "/work/widget-pr", reason: "pullRequestBranch" }],
    label: "Review PR",
    start,
  };
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("defer-review-scenario"));

  act(() => {
    fireEvent.press(view.getByLabelText("Close review chat"));
  });

  await expect(routeScreenScenario.result).resolves.toBeNull();
  expect(start).not.toHaveBeenCalled();
  expect(getAppDialogRequest()).toBeNull();
});
