import { act, fireEvent, waitFor, within } from "expo-router/testing-library";
import { useEffect, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { renderProductionPullRequestRouter } from "./fixtures/PullRequestProductionRouter";
import { productionReviewThread } from "./fixtures/PullRequestProductionScreens";

const mockEnsureReviewChat = jest.fn();
const mockNativeSheets: { readonly dismiss: Map<string, () => void> } = { dismiss: new Map() };
const mockConversationMounts = { count: 0 };
let mockDesktop = false;

jest.mock("react-native-reanimated/mock", () => {
  const mock = jest.requireActual("./mocks/Reanimated");
  return { __esModule: true, ...mock };
});
jest.mock("expo-router", () => {
  const hooks = jest.requireActual("expo-router/build/hooks");
  const { Stack: RealStack } = jest.requireActual("expo-router/build/layouts/Stack");
  const { useIsFocused: useRealIsFocused } = jest.requireActual("expo-router/build/useIsFocused");
  return {
    Stack: RealStack,
    useGlobalSearchParams: hooks.useGlobalSearchParams,
    useIsFocused: useRealIsFocused,
    useLocalSearchParams: hooks.useLocalSearchParams,
    usePathname: hooks.usePathname,
    useRouter: hooks.useRouter,
  };
});
// WHY: Node cannot create the external Compose sheet window; the mock marks each window owner by
// its dismiss label and exposes its native dismissal so the real AppSheet lifecycle stays under test.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: NativeView } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    {
      children,
      onDismissRequest,
    }: { readonly children?: ReactNode; readonly onDismissRequest: () => void },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    return (
      <NativeView testID="native-sheet-window">
        <MockSheetDismissRegistration dismiss={onDismissRequest} />
        {children}
      </NativeView>
    );
  });
  function MockSheetDismissRegistration({ dismiss }: { readonly dismiss: () => void }) {
    mockNativeSheets.dismiss.set("top", dismiss);
    return null;
  }
  return { Host, ModalBottomSheet, RNHostView: Host };
});
jest.mock("expo-symbols", () => ({}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  pullRequestCommentDestinations: {},
  reviewResources: {},
}));
jest.mock("../src/data/forgeQueryResource", () => ({ useForgeQuery: () => ({}) }));
jest.mock("../src/data/forgeRemoteValue", () => ({ remoteValue: () => null }));
jest.mock("../src/data/minuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("../src/data/workspace-runtime", () => ({
  workspaceRuntime: { fileTransferController: null, native: true, voiceController: null },
}));
jest.mock("../src/features/pullRequestDetail/actions/usePullRequestActions", () => ({
  usePullRequestActions: () => ({
    dismissInput: jest.fn(),
    pendingInput: null,
    run: jest.fn(),
    submitInput: jest.fn(),
  }),
}));
jest.mock("../src/features/pullRequestDetail/actions/ExtensionInputSheet", () => ({
  ExtensionInputSheet: () => null,
}));
jest.mock("../src/features/pullRequestDetail/OverviewPane", () => ({
  OverviewPane: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .ProductionPullRequestOverview,
}));
jest.mock("../src/features/pullRequestDetail/PullRequestAppBar", () => ({
  PullRequestAppBar: () => null,
}));
jest.mock("../src/features/pullRequestDetail/changes/PullRequestChanges", () => ({
  PullRequestChanges: () => null,
}));
jest.mock("../src/features/pullRequestDetail/usePullRequestScreen", () => ({
  threadTitle: () => "Linked thread",
  usePullRequestScreen: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .useProductionPullRequestScreen,
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    composer: { sendText: jest.fn() },
    projects: {
      addProject: jest.fn(),
      listProjects: jest.fn(),
      readDirectory: jest.fn(),
      readProjectHome: jest.fn(),
      setProjectPinned: jest.fn(),
    },
    pullRequestDetail: {
      ensureReviewChat: (...args: unknown[]) => mockEnsureReviewChat(...args),
    },
    reviewTarget: {},
  },
}));
// The conversation surface is replaced by its Manage projects entry: the regression concerns how
// the PR panes present project management, not the conversation itself.
jest.mock("../src/features/conversation/ConversationWorkspace", () => ({
  ActiveWorkspaceConversation: (props: MockConversationProps) => (
    <MockReviewConversation {...props} />
  ),
}));
jest.mock("../src/features/workspace/WorkspaceConversationProviders", () => ({
  WorkspaceConversationProviders: ({ children }: { readonly children: ReactNode }) => children,
}));
jest.mock("../src/routeComposition/LinkedPullRequestChipProvider", () => ({
  LinkedPullRequestChipProvider: ({ children }: { readonly children: ReactNode }) => children,
}));
jest.mock("../src/features/projects/projectWorkspace", () => ({
  useProjectWorkspace: () => ({
    availableSidebarProjects: [
      {
        connectionId: "server",
        key: "server:/workspace/project",
        lastUsedAt: 1,
        name: "Project",
        path: "/workspace/project",
        pinned: true,
        serverLabel: null,
        subtitle: "/workspace/project",
        unread: false,
      },
    ],
    moveSidebarProject: async () => undefined,
    sidebarProjectErrors: [],
    sidebarServers: [{ id: "server", name: "Server" }],
    toggleSidebarProject: async () => undefined,
  }),
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/routeComposition/PullRequestsCatalogRoute", () => ({
  PullRequestsPreviewRoute: () => null,
}));
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => true,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    connections: [],
    desktop: mockDesktop,
    list: {
      listState: { setThreadListMode: () => undefined },
      loadedThreadSummaries: [],
      prepareThreadLink: () => undefined,
      scopedThreads: [],
      selectThread: () => undefined,
      servers: [{ id: "server", name: "Server" }],
    },
    project: { projectWorkspace: { addSidebarProject: async () => undefined } },
    recovery: { createUnsupportedFixThread: () => undefined },
    runtime: { connectionProfiles: null, ready: false, threadSummaries: null },
    viewportWidth: mockDesktop ? 1200 : 400,
  }),
}));
jest.mock("../src/ui/AppFullscreenOverlay", () => ({
  useAppFullscreenOverlay: () => ({ present: jest.fn() }),
}));

type MockConversationProps = {
  readonly destination: { readonly kind: string };
  readonly onManageProjects: () => void;
};

/** Counts its mounts so remounting the review chat under the sheet is observable. */
function MockReviewConversation({
  destination,
  onManageProjects,
}: MockConversationProps): React.JSX.Element {
  useEffect(() => {
    mockConversationMounts.count += 1;
  }, []);
  return (
    <View testID={`review-chat-${destination.kind}`}>
      <Pressable accessibilityRole="button" onPress={onManageProjects}>
        <Text>Manage projects</Text>
      </Pressable>
    </View>
  );
}

type RenderedRouter = ReturnType<typeof renderProductionPullRequestRouter>;

function dismissTopSheet(): void {
  act(() => {
    mockNativeSheets.dismiss.get("top")?.();
  });
}

function expectPullRequestRetained(view: RenderedRouter, chat: string, mounts: number): void {
  expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
  expect(view.queryByTestId("production-threads-catalog")).toBeNull();
  // The covered PR and its chat stay mounted (the same instance) beneath the native sheet window.
  expect(view.getByTestId(chat, { includeHiddenElements: true })).toBeOnTheScreen();
  expect(mockConversationMounts.count).toBe(mounts);
}

async function openReviewChat(
  view: RenderedRouter,
  existing: boolean,
): Promise<{ readonly chat: string }> {
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  const chat = existing ? "review-chat-thread" : "review-chat-draft";
  await waitFor(() => {
    expect(view.getByTestId(chat)).toBeVisible();
  });
  return { chat };
}

beforeEach(() => {
  mockDesktop = false;
  productionReviewThread.current = null;
  mockConversationMounts.count = 0;
  mockNativeSheets.dismiss.clear();
  mockEnsureReviewChat.mockReset();
});

it.each([
  ["existing review chat beside the PR", true, true],
  ["review-chat draft beside the PR", true, false],
  ["compact review-chat draft", false, false],
])(
  "presents Manage projects over the retained PR from the %s",
  async (_label, desktop, existing) => {
    mockDesktop = desktop;
    mockEnsureReviewChat.mockImplementation(async () =>
      existing
        ? { created: false, kind: "ready", threadId: "review-thread" }
        : new Promise(() => undefined),
    );
    const view = renderProductionPullRequestRouter();
    const { chat } = await openReviewChat(view, existing);
    const mounts = mockConversationMounts.count;

    fireEvent.press(within(view.getByTestId(chat)).getByText("Manage projects"));

    const sheet = view.getByTestId("native-sheet-window");
    expect(within(sheet).getByText("Manage Projects")).toBeVisible();
    expectPullRequestRetained(view, chat, mounts);

    // Add project replaces the management sheet with the folder browser; closing returns to it.
    fireEvent.press(within(sheet).getByLabelText("Add project"));
    const browser = view.getByTestId("native-sheet-window");
    expect(within(browser).getByText("Add project")).toBeVisible();
    expect(view.queryByText("Manage Projects")).toBeNull();
    expectPullRequestRetained(view, chat, mounts);
    dismissTopSheet();
    expect(
      within(view.getByTestId("native-sheet-window")).getByText("Manage Projects"),
    ).toBeVisible();

    // Native dismissal closes management and leaves the same PR and chat on screen.
    dismissTopSheet();
    expect(view.queryByTestId("native-sheet-window")).toBeNull();
    expectPullRequestRetained(view, chat, mounts);
    expect(view.getByTestId(chat)).toBeVisible();
  },
);
