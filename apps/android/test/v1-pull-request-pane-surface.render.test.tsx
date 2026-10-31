import { act, fireEvent, render, type RenderResult } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MessageFoldedBody } from "../src/features/messageContent/MessageFoldedBody";
import type { PullRequestTab } from "../src/features/pullRequestDetail/pullRequestScreenModel";
import { PullRequestDetailPane } from "../src/routeComposition/PullRequestDetailPane";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import type { WorkspacePaneCapabilities } from "../src/routeComposition/workspacePanes";
import { colors } from "../src/theme";
import { SurfaceToneProvider } from "../src/ui/surfaceTone";
import { companion, PULL_REQUEST } from "./fixtures/pullRequestDetailsHarness";
import { conversation91 } from "./fixtures/forgeWireFixtures";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric; only its platform view is replaced.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EnrichedMarkdownTextInput: React.forwardRef(function Editor(
      props: EnrichedMarkdownTextInputProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getMarkdown: async () => Promise.resolve(""),
        setSelection: jest.fn(),
        setValue: jest.fn(),
      }));
      return <MockView {...props} testID="native-editor" />;
    }),
  };
});

// The detail pane reads the process-owned resources; here they are the fake companion's.
let mockServer: ReturnType<typeof companion> | null = null;
let mockDestinations: unknown = null;
jest.mock("../src/data/forgeRuntime", () => ({
  get forgeResources() {
    return mockServer?.forge;
  },
  get pullRequestCommentDestinations() {
    const destinations = jest.requireActual<
      typeof import("../src/data/pullRequestCommentDestinations")
    >("../src/data/pullRequestCommentDestinations");
    mockDestinations ??= destinations.createPullRequestCommentDestinations({
      deleteConnection: async () => undefined,
      read: async () => null,
      write: async () => undefined,
    });
    return mockDestinations;
  },
  get reviewResources() {
    return mockServer?.review;
  },
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    get pullRequestDetail() {
      const harness = jest.requireActual<typeof import("./fixtures/pullRequestDetailsHarness")>(
        "./fixtures/pullRequestDetailsHarness",
      );
      return harness.capabilities({});
    },
    reviewTarget: {},
  },
}));

const mounted: RenderResult[] = [];

afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) {
      view.unmount();
    }
    mockServer?.forge.queryClient.clear();
    mockServer = null;
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
});

type Navigation = {
  readonly back: jest.Mock;
  readonly closeChanges: jest.Mock;
  readonly closePane: jest.Mock;
};

/**
 * The real PR detail placed in one pane of a destination layout: the right pane beside a thread's
 * conversation (as the thread route declares it), or the center alone or beside its review chat
 * (as the PR route declares it). Only the pane declarations differ between placements.
 */
function renderPane(
  placement: "center" | "center+chat" | "right",
  tab: PullRequestTab = "overview",
) {
  if (PULL_REQUEST === null) {
    throw new Error("the pull request key fixture must parse");
  }
  mockServer = companion({
    conversation: conversation91,
    conversationDeclared: true,
    extraCapabilities: [],
    olderConversation: null,
  });
  const navigation: Navigation = {
    back: jest.fn(),
    closeChanges: jest.fn(),
    closePane: jest.fn(),
  };
  const detail = (
    <PullRequestDetailPane
      connectionId="server"
      describeThread={() => null}
      desktop={false}
      initialChangesView="files"
      isThreadUnread={() => false}
      navigation={{
        back: navigation.back,
        closeChanges: navigation.closeChanges,
        deferReviewChatScenario: async () => Promise.resolve(null),
        openChanges: () => undefined,
        openReviewChat: () => undefined,
        openThread: () => undefined,
      }}
      pullRequest={PULL_REQUEST}
      tab={tab}
    />
  );
  const conversation = {
    capabilities: placement === "right" ? {} : { close: jest.fn() },
    content: <Text>Conversation</Text>,
    label: placement === "right" ? "conversation" : "review chat",
    shows: { connectionId: "server", kind: "conversation", threadId: "thread" },
    testID: "conversation-pane",
  } as const;
  // A right pane declares close, as both routes' right panes do; the PR center declares none.
  const declared: WorkspacePaneCapabilities =
    placement === "right" ? { close: navigation.closePane } : {};
  const pane = {
    capabilities: declared,
    content: detail,
    label: "pull request",
    shows: { connectionId: "server", kind: "pullRequest", pullRequest: PULL_REQUEST },
    testID: "detail-pane",
  } as const;
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <WorkspaceCenterLayout
        active
        center={placement === "right" ? conversation : pane}
        right={placement === "right" ? pane : placement === "center+chat" ? conversation : null}
        testID="destination"
      />
    </SafeAreaProvider>,
  );
  mounted.push(view);
  return { navigation, view };
}

type HostNode = ReturnType<RenderResult["getByTestId"]>;

function backgroundOf(node: HostNode): unknown {
  // WHY: a host element's `style` prop is an arbitrary RN style tree; flattening reads its result.
  const style: { readonly backgroundColor?: unknown } = StyleSheet.flatten(node.props.style) ?? {};
  return style.backgroundColor;
}

/** The color the screen actually sits on: the background of its nearest painted host ancestor. */
function surfaceBehind(node: HostNode): unknown {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (typeof current.type === "string") {
      const background = backgroundOf(current);
      if (background !== undefined) {
        return background;
      }
    }
  }
  return undefined;
}

it("paints no surface of its own and sits on the right pane's frame surface", async () => {
  const { view } = renderPane("right");
  const screen = await view.findByTestId("pull-request-screen");

  expect(backgroundOf(screen)).toBeUndefined();
  expect(surfaceBehind(screen)).toBe(colors.threadListSurface);
});

it("sits on the center surface when the same screen is the center pane", async () => {
  const { view } = renderPane("center");
  const screen = await view.findByTestId("pull-request-screen");

  expect(backgroundOf(screen)).toBeUndefined();
  expect(surfaceBehind(screen)).toBe(colors.conversationSurface);
});

it("closes the right pane from Details with ×, without a Details Back", async () => {
  const { navigation, view } = renderPane("right");
  await view.findByTestId("pull-request-screen");

  expect(view.queryByLabelText("Back")).toBeNull();
  fireEvent.press(view.getByLabelText("Close pull request"));
  expect(navigation.closePane).toHaveBeenCalledTimes(1);
  expect(navigation.back).not.toHaveBeenCalled();
});

it("keeps × beside Back on the right pane's nested Changes view", async () => {
  const { navigation, view } = renderPane("right", "changes");
  await view.findByTestId("pull-request-changes");

  fireEvent.press(view.getByLabelText("Back"));
  expect(navigation.closeChanges).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText("Close pull request"));
  expect(navigation.closePane).toHaveBeenCalledTimes(1);
});

it("hides the linked-chat button while the neighbouring pane shows a conversation", async () => {
  const right = renderPane("right");
  await right.view.findByTestId("pull-request-screen");
  expect(right.view.queryByTestId("pull-request-linked-chat")).toBeNull();

  const beside = renderPane("center+chat");
  await beside.view.findByTestId("pull-request-screen", { includeHiddenElements: true });
  expect(
    beside.view.queryByTestId("pull-request-linked-chat", { includeHiddenElements: true }),
  ).toBeNull();
});

it("offers the linked-chat button when no conversation is beside the PR", async () => {
  const { view } = renderPane("center");
  await view.findByTestId("pull-request-screen");
  expect(view.getByTestId("pull-request-linked-chat")).toBeOnTheScreen();
});

it("keeps the route's Back and shows no × in the center", async () => {
  const { navigation, view } = renderPane("center");
  await view.findByTestId("pull-request-screen");

  expect(view.queryByLabelText("Close pull request")).toBeNull();
  fireEvent.press(view.getByLabelText("Back"));
  expect(navigation.back).toHaveBeenCalledTimes(1);
});

/** A folded body; the fade appears once the body measures taller than the fold. */
function renderFolded(tone: "raised" | "recessed") {
  const view = render(
    <SurfaceToneProvider value={tone}>
      <View>
        <MessageFoldedBody content={{ attachments: [], markdown: "Long body" }} testID="message" />
      </View>
    </SurfaceToneProvider>,
  );
  mounted.push(view);
  act(() => {
    view.getByTestId("message-body").props.onLayout({
      nativeEvent: { layout: { height: 600, width: 400, x: 0, y: 0 } },
    });
  });
  const fade: { readonly experimental_backgroundImage?: unknown } =
    StyleSheet.flatten(view.getByTestId("message-fade").props.style) ?? {};
  return String(fade.experimental_backgroundImage);
}

it("fades a folded message into the surface of the pane it sits on", () => {
  expect(renderFolded("raised")).toContain(colors.conversationSurface);
  expect(renderFolded("recessed")).toContain(colors.threadListSurface);
  expect(renderFolded("raised")).not.toContain(colors.threadListSurface);
});
