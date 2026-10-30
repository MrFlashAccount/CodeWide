import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";

import { conversation91, conversationArcanum } from "./fixtures/forgeWireFixtures";
import {
  PULL_REQUEST,
  REVIEW_CHAT,
  renderScreen,
  textOf,
  type,
  unmountScreens,
  type Capabilities,
} from "./fixtures/pullRequestDetailsHarness";
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

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
    AppSheetScrollView: ({
      children,
      testID,
    }: {
      readonly children: ReactNode;
      readonly testID?: string;
    }) => <MockView testID={testID}>{children}</MockView>,
  };
});

beforeEach(() => {
  resetAppDialog();
});

afterEach(async () => {
  await unmountScreens();
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

/** The conversation's entries and "Show more" control in rendered order. */
function discussionOrder(conversation: Parameters<typeof within>[0]): string[] {
  return within(conversation)
    .getAllByTestId(
      /^(pull-request-discussion-more$|conversation-(comment|event)-[a-z]+-\d+$|conversation-review-r-\d$|review-thread-rt-\d$)/u,
    )
    .map((node) => String(node.props.testID));
}

it("renders the conversation newest first instead of the activity list", async () => {
  const { view } = renderScreen({});

  await view.findByTestId("conversation-comment-c-1");
  const conversation = view.getByTestId("pull-request-conversation");
  expect(view.queryByTestId("pull-request-activity")).toBeNull();
  expect(discussionOrder(conversation)).toEqual([
    "conversation-event-e-1",
    "review-thread-rt-2",
    "conversation-review-r-1",
    "review-thread-rt-1",
    // A thread still reads top-down.
    "conversation-comment-c-2",
    "conversation-comment-c-3",
    "conversation-comment-c-4",
    "conversation-comment-c-1",
  ]);
  // The review is a verdict row, its text below and its inline thread inside it.
  const review = view.getByTestId("conversation-review-r-1");
  expect(within(review).getByTestId("conversation-review-r-1-row")).toHaveProp(
    "accessibilityLabel",
    expect.stringMatching(/^mikhail-p requested changes, /u) as string,
  );
  expect(within(review).getByTestId("conversation-review-card-r-1")).toHaveTextContent(
    /Two small things inline/u,
  );
  expect(within(review).getByTestId("review-thread-rt-1")).toBeOnTheScreen();
  // Events are one-line rows naming the actor and what happened.
  expect(view.getByTestId("conversation-event-e-1")).toHaveTextContent(
    /dana-r merged main into this branch/u,
  );
  expect(view.getByLabelText("👍 3 reactions, including yours")).toBeOnTheScreen();
  // New top-level comments come from the floating Comment button, not an inline input.
  expect(within(conversation).queryByTestId("pull-request-new-comment")).toBeNull();
  expect(view.getByTestId("pull-request-comment-button")).toBeOnTheScreen();
});

it("loads older discussion below the newest entries from Show more", async () => {
  const [event, , , , comment] = conversation91.entries;
  const older = {
    entries: [
      {
        author: null,
        category: "state",
        createdAt: "2026-10-20T07:00:00Z",
        id: "e-0",
        kind: "event",
        text: "opened this pull request",
      },
    ],
    nextCursor: null,
    openIssuesBlockMerge: null,
  };
  const { server, view } = renderScreen({
    conversation: { entries: [event, comment], nextCursor: "older-1", openIssuesBlockMerge: null },
    olderConversation: older,
  });
  const more = await view.findByTestId("pull-request-discussion-more");
  const conversation = view.getByTestId("pull-request-conversation");
  expect(discussionOrder(conversation)).toEqual([
    "conversation-event-e-1",
    "conversation-comment-c-1",
    "pull-request-discussion-more",
  ]);

  fireEvent.press(more);

  await view.findByTestId("conversation-event-e-0");
  expect(server.cursors).toEqual(["older-1"]);
  // Older entries continue below; nothing above the newest entry moves.
  expect(discussionOrder(conversation)).toEqual([
    "conversation-event-e-1",
    "conversation-comment-c-1",
    "conversation-event-e-0",
  ]);
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
  fireEvent.press(await view.findByTestId("pull-request-comment-button"));
  const comment = within(view.getByTestId("pull-request-new-comment"));
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
  // A refused comment keeps the composer open with its text.
  expect(view.getByTestId("pull-request-comment-sheet")).toBeOnTheScreen();
});

it("renders an Arcanum-shaped discussion: the Issues row, iterations, verdict rows and machine authors", async () => {
  const { view } = renderScreen({ conversation: conversationArcanum });
  const issues = await view.findByTestId("discussion-issues");

  const row = view.getByTestId("pull-request-status-issues");
  expect(within(row).getByTestId("pull-request-status-issues-detail")).toHaveTextContent(
    "2 open · blocks merge",
  );
  // Expanded while an issue is open: open issues first, newest first; settled ones wait.
  expect(
    within(issues)
      .getAllByTestId(/^discussion-issue-is-[a-z]+(?:-line|-pr)?$/u)
      .map((node) => String(node.props.testID)),
  ).toEqual(["discussion-issue-is-open-pr", "discussion-issue-is-open-line"]);
  const line = view.getByTestId("discussion-issue-is-open-line");
  expect(within(line).getByText("disk/volga/api.py:10-12")).toBeOnTheScreen();
  expect(within(line).getByText("Race")).toBeOnTheScreen();
  expect(within(line).getByTestId("discussion-issue-is-open-line-reveal")).toHaveProp(
    "accessibilityLabel",
    "View code",
  );
  const prLevel = view.getByTestId("discussion-issue-is-open-pr");
  expect(within(prLevel).getByText("Pull request")).toBeOnTheScreen();
  expect(within(prLevel).getByText(/^arc-robot · /u)).toBeOnTheScreen();

  fireEvent.press(within(issues).getByTestId("discussion-settled-toggle"));
  expect(
    within(issues)
      .getAllByTestId(/^discussion-issue-is-[a-z]+(?:-line|-pr)?$/u)
      .map((node) => String(node.props.testID)),
  ).toEqual([
    "discussion-issue-is-open-pr",
    "discussion-issue-is-open-line",
    "discussion-issue-is-resolved",
    "discussion-issue-is-dropped",
  ]);
  expect(within(issues).getByText(/^resolved by arc-robot · /u)).toBeOnTheScreen();
  expect(within(issues).getByText(/^dropped by olga\.v · /u)).toBeOnTheScreen();
  // Collapsing the row hides its issues.
  fireEvent.press(within(row).getByTestId("pull-request-status-issues-toggle"));
  expect(view.queryByTestId("discussion-issues")).toBeNull();

  // Thread headers: the state as a word, the iteration only when it is not the newest.
  const header = (id: string): string => textOf(view.getByTestId(`review-thread-${id}-toggle`));
  expect(header("is-open-line")).toMatch(/Open issue/u);
  expect(header("is-open-line")).not.toMatch(/Iteration/u);
  expect(header("is-dropped")).toMatch(/Iteration 1.*Outdated.*Dropped/u);
  expect(header("is-resolved")).toMatch(/Iteration 2.*Resolved/u);
  expect(view.getByTestId("review-thread-is-open-pr-toggle")).toHaveProp(
    "accessibilityLabel",
    "Pull request, open issue, iteration 3",
  );
  // The merge-blocking review is a row containing its issue; the withdrawn approval is one row.
  const block = view.getByTestId("conversation-review-rv-block");
  expect(within(block).getByTestId("conversation-review-rv-block-row")).toHaveTextContent(
    /code-assistant blocked merging/u,
  );
  expect(within(block).getByTestId("review-thread-is-open-line")).toBeOnTheScreen();
  expect(view.getByTestId("conversation-verdict-rv-approve")).toHaveProp(
    "accessibilityLabel",
    expect.stringMatching(/^code-assistant, AI withdrew their approval, /u) as string,
  );
  // A bot is badged under its name and spoken with it.
  expect(view.getAllByLabelText("arc-robot, Bot").length).toBeGreaterThan(0);
  // A PR-level issue the viewer cannot reply to has no reply input.
  expect(view.queryByTestId("review-thread-is-open-pr-reply")).toBeNull();
  // Arcanum withdrew its only verdict, so there is no Reviews row.
  expect(view.queryByTestId("pull-request-status-reviews")).toBeNull();
});

it("starts settled issues collapsed and reveals one from the Issues row", async () => {
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

it("addresses an issue from the Issues row with its thread id", async () => {
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

it("groups nearby comments under one header and collapses a run of pushes, newest first", async () => {
  const { view } = renderScreen({ conversation: conversationArcanum });
  const newest = await view.findByTestId("conversation-comment-ac-2");
  const older = view.getByTestId("conversation-comment-ac-1");

  // The newer comment carries the group's header; the older one continues below it.
  expect(within(newest).getByText("olga.v")).toBeOnTheScreen();
  expect(within(newest).getByText("Pushed.")).toBeOnTheScreen();
  expect(within(older).queryByText("olga.v")).toBeNull();
  expect(within(older).getByText("Fixing both now.")).toBeOnTheScreen();

  const run = view.getByTestId("conversation-events-ev-3-toggle");
  expect(run).toHaveTextContent(/3 updates pushed/u);
  expect(view.queryByTestId("conversation-event-ev-2")).toBeNull();
  fireEvent.press(run);
  expect(
    within(view.getByTestId("conversation-events-ev-3"))
      .getAllByTestId(/^conversation-event-ev-\d$/u)
      .map((node) => String(node.props.testID)),
  ).toEqual(["conversation-event-ev-3", "conversation-event-ev-2", "conversation-event-ev-1"]);
  expect(view.getByTestId("conversation-event-ev-2")).toHaveTextContent(
    /olga\.v uploaded iteration 2/u,
  );
});
