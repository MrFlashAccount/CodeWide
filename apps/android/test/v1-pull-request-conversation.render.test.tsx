import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Suspense, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createPullRequestCommentDestinations } from "../src/data/pullRequestCommentDestinations";
import { createReviewResources } from "../src/data/reviewResources";
import { threadId } from "../src/data/reviewContract";
import { PullRequestScreen } from "../src/features/pullRequestDetail/PullRequestScreen";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import type { ReviewTargetCapabilities } from "../src/features/review/reviewTargetCapabilities";
import {
  connectedAccount,
  conversation91,
  conversationArcanum,
  githubConversationProvider,
  githubProvider,
  overview91,
} from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric. This adapter replaces only its platform view;
// typing is simulated through the same text and Markdown events the native editor emits.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
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
      return <View {...props} testID="native-editor" />;
    }),
  };
});

const PULL_REQUEST = parsePullRequestKeyParam(overview91.pullRequest);
const REVIEW_CHAT = threadId("thread-review-chat", "threadId");

type Capabilities = PullRequestDetailWorkspaceCapabilities;

/** A companion that answers the PR reads until `goOffline` makes it unreachable. */
function companion({
  conversation,
  conversationDeclared,
}: {
  readonly conversation: unknown;
  readonly conversationDeclared: boolean;
}) {
  const reads: string[] = [];
  let reachable = true;
  const answers: Readonly<Record<string, unknown>> = {
    "companion/forge/accounts/read": {
      accounts: [connectedAccount],
      flows: [],
      providers: [conversationDeclared ? githubConversationProvider : githubProvider],
    },
    "companion/pullRequest/activity/read": overview91.activity,
    "companion/pullRequest/conversation/read": conversation,
    "companion/pullRequest/files/read": { files: [], headRevision: "head-1", nextCursor: null },
    "companion/pullRequest/read": overview91,
    "companion/review/drafts/read": { drafts: [] },
  };
  const rpcAfterAttach = async <Result,>(_session: unknown, method: string): Promise<Result> => {
    reads.push(method);
    await Promise.resolve();
    if (!reachable) {
      throw new Error("The companion is unreachable");
    }
    if (!(method in answers)) {
      throw new RpcResponseError(-32_601, `Unknown ${method}`);
    }
    // WHY: the fake transport returns wire fixtures; the app's own parsers validate them.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return answers[method] as Result;
  };
  // WHY: the fake session is only a handle passed back to rpcAfterAttach.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const session = {} as never;
  const forge = createForgeResources({
    getSession: () => session,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach,
  });
  const review = createReviewResources({
    getSession: () => session,
    queryClient: forge.queryClient,
    rpcAfterAttach,
  });
  return {
    forge,
    goOffline: () => {
      reachable = false;
    },
    reads,
    review,
  };
}

function capabilities(overrides: Partial<Capabilities>): Capabilities {
  const unused = async (): Promise<never> => Promise.reject(new Error("not part of this test"));
  return {
    createComment: unused,
    ensureReviewChat: unused,
    markAttentionSeen: async () => undefined,
    replyToReviewThread: unused,
    runAction: unused,
    setLink: unused,
    setViewed: unused,
    startScenario: unused,
    submitReview: unused,
    transferAccess: unused,
    ...overrides,
  };
}

/** No chat is unread: the review chat badge is covered by its own test. */
function readNoChat(): boolean {
  return false;
}

function renderScreen({
  capabilityOverrides = {},
  conversation = conversation91,
  conversationDeclared = true,
  openChanges = jest.fn(),
  openThread = jest.fn(),
}: {
  readonly capabilityOverrides?: Partial<Capabilities>;
  readonly conversation?: unknown;
  readonly conversationDeclared?: boolean;
  readonly openChanges?: (view: "files" | "guide") => void;
  readonly openThread?: (id: string) => void;
}) {
  if (PULL_REQUEST === null) {
    throw new Error("the pull request key fixture must parse");
  }
  const server = companion({ conversation, conversationDeclared });
  const wrap = (children: ReactNode) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <Suspense fallback={<Text>Loading pull request</Text>}>{children}</Suspense>
    </SafeAreaProvider>
  );
  const view = render(
    wrap(
      <PullRequestScreen
        capabilities={capabilities(capabilityOverrides)}
        commentDestinations={createPullRequestCommentDestinations({
          deleteConnection: async () => undefined,
          read: async () => null,
          write: async () => undefined,
        })}
        connectionId="server"
        describeThread={() => null}
        forge={server.forge}
        isThreadUnread={readNoChat}
        navigation={{
          back: () => undefined,
          chatVisible: true,
          closeChanges: () => undefined,
          deferReviewChatScenario: async () => Promise.resolve(null),
          openPullRequestFullscreen: () => undefined,
          openReviewChat: () => undefined,
          openChanges,
          openThread,
          pullRequestFullscreen: false,
        }}
        pullRequest={PULL_REQUEST}
        review={server.review}
        // WHY: the Details tab never reaches the Changes review target; an empty owner suffices.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        reviewCapabilities={{} as ReviewTargetCapabilities}
        initialChangesView="files"
        tab="overview"
        tablet={false}
      />,
    ),
  );
  mounted.push({ clear: () => server.forge.queryClient.clear(), unmount: view.unmount });
  return { server, view };
}

/** Types into one reply input through the editor's native text and Markdown events. */
function type(input: ReturnType<typeof within>, text: string): void {
  const editor = input.getByTestId("native-editor");
  act(() => {
    editor.props.onChangeText(text);
    editor.props.onChangeMarkdown(text);
  });
}

const mounted: { readonly clear: () => void; readonly unmount: () => void }[] = [];

beforeEach(() => {
  resetAppDialog();
});

afterEach(async () => {
  // Stops the screen's queries and delivers TanStack's last batched notification inside act.
  await act(async () => {
    for (const screen of mounted.splice(0)) {
      screen.unmount();
      screen.clear();
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
});

it("opens Files changed and the review guide as nested routes from Details", async () => {
  const openChanges = jest.fn();
  const { view } = renderScreen({ openChanges });
  fireEvent.press(await view.findByTestId("pull-request-open-changes"));
  expect(openChanges).toHaveBeenLastCalledWith("files");
  fireEvent.press(view.getByTestId("pull-request-open-guide"));
  expect(openChanges).toHaveBeenLastCalledWith("guide");
  expect(view.queryByRole("tab")).toBeNull();
});

it("renders the conversation in the forge's order instead of the activity list", async () => {
  const { view } = renderScreen({});

  await view.findByTestId("conversation-comment-c-1");
  const conversation = view.getByTestId("pull-request-conversation");
  expect(view.queryByTestId("pull-request-activity")).toBeNull();
  const order = within(conversation)
    .getAllByTestId(
      /^(conversation-(comment|event)-|conversation-review-r-\d$|review-thread-rt-\d$)/u,
    )
    .map((node) => String(node.props.testID));
  expect(order).toEqual([
    "conversation-comment-c-1",
    "conversation-review-r-1",
    "review-thread-rt-1",
    "conversation-comment-c-2",
    "conversation-comment-c-3",
    "conversation-comment-c-4",
    "review-thread-rt-2",
    "conversation-event-e-1",
  ]);
  expect(within(conversation).getByText(/Changes requested/u)).toBeOnTheScreen();
  // The review's inline thread is drawn inside the review's card.
  expect(
    within(view.getByTestId("conversation-review-r-1")).getByTestId("review-thread-rt-1"),
  ).toBeOnTheScreen();
  expect(view.getByLabelText("👍 3 reactions, including yours")).toBeOnTheScreen();
  expect(view.getByTestId("pull-request-new-comment")).toBeOnTheScreen();
});

it("keeps the activity list when the plugin does not declare the conversation", async () => {
  const { server, view } = renderScreen({ conversationDeclared: false });

  expect(await view.findByTestId("pull-request-activity")).toBeOnTheScreen();
  expect(view.queryByTestId("pull-request-conversation")).toBeNull();
  await waitFor(() => {
    expect(server.forge.queryClient.isFetching()).toBe(0);
  });
  expect(server.reads).not.toContain("companion/pullRequest/conversation/read");
});

it("starts a resolved thread collapsed and expands it from its header", async () => {
  const { view } = renderScreen({});
  const toggle = await view.findByTestId("review-thread-rt-2-toggle");

  expect(view.queryByTestId("conversation-comment-c-5")).toBeNull();
  expect(within(toggle).getByText("1 comment")).toBeOnTheScreen();

  fireEvent.press(toggle);

  expect(view.getByTestId("conversation-comment-c-5")).toBeOnTheScreen();
  expect(view.getByTestId("conversation-comment-c-2")).toBeOnTheScreen();
});

it("replies once with the thread id and a key, shimmering the text until it clears", async () => {
  let acknowledge: (() => void) | null = null;
  const replyToReviewThread = jest.fn<
    ReturnType<Capabilities["replyToReviewThread"]>,
    Parameters<Capabilities["replyToReviewThread"]>
  >(
    async (_target, request) =>
      new Promise((resolve) => {
        acknowledge = () => {
          resolve({
            author: { avatarUrl: null, login: "sergeigarin" },
            body: request.body,
            createdAt: "2026-10-21T11:00:00Z",
            // WHY: the acknowledged comment is a fixture; the screen renders only its shape.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            id: "c-new" as never,
            reactions: [],
            updatedAt: null,
            url: null,
          });
        };
      }),
  );
  const { view } = renderScreen({ capabilityOverrides: { replyToReviewThread } });
  const reply = within(await view.findByTestId("review-thread-rt-1-reply"));

  type(reply, "Keeping the host hint");
  fireEvent.press(reply.getByTestId("review-thread-rt-1-reply-send"));
  fireEvent.press(reply.getByTestId("review-thread-rt-1-reply-send"));

  expect(replyToReviewThread).toHaveBeenCalledTimes(1);
  const [target, request] = replyToReviewThread.mock.calls[0] ?? [];
  expect(target).toEqual({ connectionId: "server", pullRequest: PULL_REQUEST });
  expect(request).toMatchObject({ body: "Keeping the host hint", threadId: "rt-1" });
  expect(request?.idempotencyKey).toEqual(expect.any(String));
  // The typed text stays in place as the shimmer target; the native decoration needs a device.
  const pending = reply.getByTestId("review-thread-rt-1-reply-pending");
  expect(pending).toHaveTextContent("Keeping the host hint");
  expect(pending.props.accessibilityState).toEqual({ busy: true });
  expect(reply.getByTestId("review-thread-rt-1-reply-send")).toBeDisabled();

  await act(async () => {
    acknowledge?.();
    await Promise.resolve();
  });

  expect(reply.queryByTestId("review-thread-rt-1-reply-pending")).toBeNull();
  expect(reply.queryByTestId("review-thread-rt-1-reply-error")).toBeNull();
  expect(reply.getByTestId("review-thread-rt-1-reply-send")).toBeDisabled();
});

it("keeps the text and shows the companion's error when a reply fails", async () => {
  const replyToReviewThread = jest.fn<
    ReturnType<Capabilities["replyToReviewThread"]>,
    Parameters<Capabilities["replyToReviewThread"]>
  >(async () => Promise.reject(new RpcResponseError(-32_083, "The forge refused the reply")));
  const { view } = renderScreen({ capabilityOverrides: { replyToReviewThread } });
  const reply = within(await view.findByTestId("review-thread-rt-1-reply"));

  type(reply, "Keeping the host hint");
  fireEvent.press(reply.getByTestId("review-thread-rt-1-reply-send"));

  expect(await reply.findByTestId("review-thread-rt-1-reply-error")).toHaveTextContent(
    "The forge refused the reply",
  );
  expect(reply.queryByTestId("review-thread-rt-1-reply-pending")).toBeNull();
  // The same editor instance stays mounted with its text, so Send can try again.
  expect(reply.getByTestId("review-thread-rt-1-reply-send")).toBeEnabled();
});

it("retries an unreached reply with the same key, and edited text with a new key", async () => {
  const replyToReviewThread = jest.fn<
    ReturnType<Capabilities["replyToReviewThread"]>,
    Parameters<Capabilities["replyToReviewThread"]>
  >(async () => Promise.reject(new Error("The companion is unreachable")));
  const { view } = renderScreen({ capabilityOverrides: { replyToReviewThread } });
  const reply = within(await view.findByTestId("review-thread-rt-1-reply"));
  const send = async (): Promise<void> => {
    fireEvent.press(reply.getByTestId("review-thread-rt-1-reply-send"));
    await reply.findByTestId("review-thread-rt-1-reply-error");
  };

  type(reply, "Keeping the host hint");
  await send();
  await send();
  type(reply, "Keeping the host hint, with the port");
  await send();

  const keys = replyToReviewThread.mock.calls.map(([, request]) => request.idempotencyKey);
  expect(keys).toHaveLength(3);
  // The request may have reached the companion: the same text must not publish twice.
  expect(keys[1]).toBe(keys[0]);
  // Edited text is a new write, never a replay of the earlier text's outcome.
  expect(keys[2]).not.toBe(keys[0]);
});

it("starts addressComments focused on the thread and opens the review chat", async () => {
  const startScenario = jest.fn<
    ReturnType<Capabilities["startScenario"]>,
    Parameters<Capabilities["startScenario"]>
  >(async () => Promise.resolve({ created: false, kind: "started", threadId: REVIEW_CHAT }));
  const openThread = jest.fn();
  const { view } = renderScreen({ capabilityOverrides: { startScenario }, openThread });

  fireEvent.press(await view.findByTestId("review-thread-rt-1-address"));

  await waitFor(() => {
    expect(openThread).toHaveBeenCalledWith(REVIEW_CHAT);
  });
  expect(startScenario).toHaveBeenCalledTimes(1);
  expect(startScenario.mock.calls[0]?.[1]).toMatchObject({
    reviewThreadId: "rt-1",
    scenario: "addressComments",
    target: { kind: "reviewChat", workspace: { kind: "ask" } },
  });
});

it("refuses conversation writes locally while the companion is offline", async () => {
  const createComment = jest.fn<
    ReturnType<Capabilities["createComment"]>,
    Parameters<Capabilities["createComment"]>
  >();
  const startScenario = jest.fn<
    ReturnType<Capabilities["startScenario"]>,
    Parameters<Capabilities["startScenario"]>
  >();
  const { server, view } = renderScreen({
    capabilityOverrides: { createComment, startScenario },
  });
  const comment = within(await view.findByTestId("pull-request-new-comment"));
  server.goOffline();
  await act(async () => {
    if (PULL_REQUEST !== null) {
      await server.forge.overviews
        .refresh({ connectionId: "server", pullRequest: PULL_REQUEST })
        .catch(() => undefined);
    }
  });
  // TanStack delivers the failed refresh to the mounted observer on its next tick.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  type(comment, "Ship it");
  await act(async () => {
    fireEvent.press(comment.getByTestId("pull-request-new-comment-send"));
    await Promise.resolve();
  });
  fireEvent.press(view.getByTestId("review-thread-rt-1-address"));

  expect(getAppDialogRequest()?.title).toBe("The companion is offline");
  expect(createComment).not.toHaveBeenCalled();
  expect(startScenario).not.toHaveBeenCalled();
  expect(comment.queryByTestId("pull-request-new-comment-pending")).toBeNull();
  expect(comment.getByTestId("pull-request-new-comment-send")).toBeEnabled();
});

/** Every element of a pressable or text tree, flattened to its visible text. */
function textOf(node: Parameters<typeof within>[0]): string {
  return within(node)
    .queryAllByText(/.+/u)
    .map((child) => String(child.props.children))
    .join(" ");
}

it("sets the Discussion apart from the description with its heading, count and summary", async () => {
  const { view } = renderScreen({});
  // The heading renders before the first page; wait for the loaded count, not just the heading.
  await view.findByTestId("pull-request-discussion-count");
  const heading = view.getByTestId("pull-request-discussion-heading");

  expect(within(heading).getByRole("header")).toHaveTextContent("Discussion");
  expect(within(heading).getByTestId("pull-request-discussion-count")).toHaveTextContent("6");
  expect(within(heading).getByTestId("pull-request-discussion-summary")).toHaveTextContent(
    /1 unresolved/u,
  );
  const section = view.getByTestId("pull-request-conversation");
  expect(section).toHaveStyle({ borderTopWidth: expect.any(Number) as number });
  // The description is its own section, before the Discussion, never inside it.
  const description = view.getByTestId("pull-request-description");
  expect(within(section).queryByTestId("pull-request-description")).toBeNull();
  const page = view.getByTestId("pull-request-overview");
  const order = within(page)
    .getAllByTestId(/^pull-request-(description|conversation)$/u)
    .map((node) => String(node.props.testID));
  expect(order).toEqual(["pull-request-description", "pull-request-conversation"]);
  expect(description).toBeOnTheScreen();
  // GitHub reports no issues, so nothing is pinned.
  expect(view.queryByTestId("discussion-issues")).toBeNull();
});

it("renders an Arcanum-shaped discussion: pinned issues, iterations, verdict rows and initials", async () => {
  const { view } = renderScreen({ conversation: conversationArcanum });
  const issues = await view.findByTestId("discussion-issues");

  expect(view.getByTestId("pull-request-discussion-summary")).toHaveTextContent(
    /2 open issues · blocks merge/u,
  );
  // Open issues first; resolved and dropped wait behind their counter.
  expect(
    within(issues)
      .getAllByTestId(/^discussion-issue-is-[a-z]+(?:-line|-pr)?$/u)
      .map((node) => String(node.props.testID)),
  ).toEqual(["discussion-issue-is-open-line", "discussion-issue-is-open-pr"]);
  const line = view.getByTestId("discussion-issue-is-open-line");
  expect(within(line).getByText("disk/volga/api.py:10-12")).toBeOnTheScreen();
  expect(within(line).getByText("Race")).toBeOnTheScreen();
  expect(
    within(view.getByTestId("discussion-issue-is-open-pr")).getByText("Pull request"),
  ).toBeOnTheScreen();
  // No avatars: the initials stand in.
  expect(within(line).getByText("CA", { includeHiddenElements: true })).toBeOnTheScreen();

  fireEvent.press(within(issues).getByTestId("discussion-settled-toggle"));
  expect(
    within(issues)
      .getAllByTestId(/^discussion-issue-is-[a-z]+(?:-line|-pr)?$/u)
      .map((node) => String(node.props.testID)),
  ).toEqual([
    "discussion-issue-is-open-line",
    "discussion-issue-is-open-pr",
    "discussion-issue-is-dropped",
    "discussion-issue-is-resolved",
  ]);
  expect(within(issues).getByText("resolved by arc-robot")).toBeOnTheScreen();
  expect(within(issues).getByText("dropped by olga.v")).toBeOnTheScreen();

  // Issue badges and iteration chips in the thread headers.
  const badges = (id: string): string => textOf(view.getByTestId(`review-thread-${id}-toggle`));
  expect(badges("is-open-line")).toMatch(/Open issue.*Iteration 3/u);
  expect(badges("is-dropped")).toMatch(/Dropped.*Iteration 1.*Outdated/u);
  expect(badges("is-resolved")).toMatch(/Resolved.*Iteration 2/u);
  expect(view.getByTestId("review-thread-is-open-pr-toggle")).toHaveProp(
    "accessibilityLabel",
    "Pull request, open issue, iteration 3",
  );
  // The merge-blocking review contains its issue; the withdrawn approval is one quiet row.
  const block = view.getByTestId("conversation-review-rv-block");
  expect(within(block).getByText(/Blocks merge/u)).toBeOnTheScreen();
  expect(within(block).getByTestId("review-thread-is-open-line")).toBeOnTheScreen();
  expect(view.getByTestId("conversation-verdict-rv-approve")).toHaveTextContent(
    /code-assistant.*AI.*withdrew their approval/u,
  );
  // An AI reviewer and a bot are marked next to their names.
  expect(view.getAllByLabelText("arc-robot, bot").length).toBeGreaterThan(0);
  // A PR-level issue the viewer cannot reply to has no reply input.
  expect(view.queryByTestId("review-thread-is-open-pr-reply")).toBeNull();
});

it("starts settled issues collapsed and reveals one from the pinned list", async () => {
  const measure = jest
    .spyOn(
      View.prototype as unknown as { measureLayout: (...args: unknown[]) => void },
      "measureLayout",
    )
    .mockImplementation((_relative: unknown, success: unknown) => {
      if (typeof success === "function") {
        success(0, 480);
      }
    });
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  try {
    const { view } = renderScreen({ conversation: conversationArcanum });
    const issues = await view.findByTestId("discussion-issues");
    expect(view.queryByTestId("conversation-comment-ic-4")).toBeNull();

    fireEvent.press(within(issues).getByTestId("discussion-settled-toggle"));
    fireEvent.press(view.getByTestId("discussion-issue-is-resolved-reveal"));

    expect(view.getByTestId("conversation-comment-ic-4")).toBeOnTheScreen();
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: 480 });
  } finally {
    measure.mockRestore();
    scrollTo.mockRestore();
  }
});

it("addresses an issue from the pinned list with its thread id", async () => {
  const startScenario = jest.fn<
    ReturnType<Capabilities["startScenario"]>,
    Parameters<Capabilities["startScenario"]>
  >(async () => Promise.resolve({ created: false, kind: "started", threadId: REVIEW_CHAT }));
  const openThread = jest.fn();
  const { view } = renderScreen({
    capabilityOverrides: { startScenario },
    conversation: conversationArcanum,
    openThread,
  });

  fireEvent.press(await view.findByTestId("discussion-issue-is-open-pr-address"));

  await waitFor(() => {
    expect(openThread).toHaveBeenCalledWith(REVIEW_CHAT);
  });
  expect(startScenario.mock.calls[0]?.[1]).toMatchObject({
    reviewThreadId: "is-open-pr",
    scenario: "addressComments",
  });
});

it("groups nearby comments under one header and collapses a run of pushes", async () => {
  const { view } = renderScreen({ conversation: conversationArcanum });
  const first = await view.findByTestId("conversation-comment-ac-1");
  const second = view.getByTestId("conversation-comment-ac-2");

  expect(within(first).getByText("olga.v")).toBeOnTheScreen();
  expect(within(second).queryByText("olga.v")).toBeNull();
  expect(within(second).getByText("Pushed.")).toBeOnTheScreen();

  const run = view.getByTestId("conversation-events-ev-1-toggle");
  expect(run).toHaveTextContent(/3 updates pushed/u);
  expect(view.queryByTestId("conversation-event-ev-2")).toBeNull();
  fireEvent.press(run);
  expect(view.getByTestId("conversation-event-ev-2")).toHaveTextContent(
    /olga\.v uploaded iteration 2/u,
  );
});
