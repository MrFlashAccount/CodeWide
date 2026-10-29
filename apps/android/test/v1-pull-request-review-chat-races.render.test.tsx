import { act, renderHook } from "@testing-library/react-native";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { threadId, type ThreadId } from "../src/data/reviewContract";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import { usePullRequestReviewChat } from "../src/routeComposition/usePullRequestReviewChat";

type EnsureReviewChat = PullRequestDetailWorkspaceCapabilities["ensureReviewChat"];
type ReviewChatProps = Parameters<typeof usePullRequestReviewChat>[0];

const mockEnsureReviewChat = jest.fn<ReturnType<EnsureReviewChat>, Parameters<EnsureReviewChat>>();
const mockSetDetailExpanded = jest.fn();
let mockNavigateToLinkedThread = jest.fn<void, [string, ThreadId]>();

jest.mock("../src/routeComposition/pullRequestNavigation", () => ({
  linkedThreadSelectionKey: (connectionId: string, resolvedThreadId: string) =>
    `${connectionId}:${resolvedThreadId}`,
  usePullRequestNavigation: () => ({ navigateToLinkedThread: mockNavigateToLinkedThread }),
}));
jest.mock("../src/routeComposition/pullRequestsPaneController", () => ({
  usePullRequestsPaneController: () => ({ setDetailExpanded: mockSetDetailExpanded }),
}));

const pullRequest = parsePullRequestKeyParam("fpr1.github-91");
if (pullRequest === null) {
  throw new Error("Expected a valid pull-request fixture key");
}

function reviewChatProps({
  desktop,
  prepareThreadLink,
  routeActive = true,
  viewportWidth,
}: {
  readonly desktop: boolean;
  readonly prepareThreadLink: (selectionKey: string) => void;
  readonly routeActive?: boolean;
  readonly viewportWidth: number;
}): ReviewChatProps {
  return {
    connectionId: "server",
    desktop,
    ensureReviewChat: mockEnsureReviewChat,
    prepareThreadLink,
    pullRequest,
    routeActive,
    sendText: jest.fn(),
    viewportWidth,
  };
}

beforeEach(() => {
  mockEnsureReviewChat.mockReset();
  mockNavigateToLinkedThread = jest.fn<void, [string, ThreadId]>();
  mockSetDetailExpanded.mockClear();
});

it("uses current compact layout and navigation inputs when a wide suggestion request finds a chat", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<EnsureReviewChat>>>();
  const initialPrepare = jest.fn();
  const currentPrepare = jest.fn();
  const initialNavigate = mockNavigateToLinkedThread;
  mockEnsureReviewChat.mockReturnValue(pending.promise);
  const hook = renderHook(usePullRequestReviewChat, {
    initialProps: reviewChatProps({
      desktop: true,
      prepareThreadLink: initialPrepare,
      viewportWidth: 1200,
    }),
  });

  act(() => {
    hook.result.current.openReviewChat(null);
  });
  mockNavigateToLinkedThread = jest.fn<void, [string, ThreadId]>();
  hook.rerender(
    reviewChatProps({ desktop: false, prepareThreadLink: currentPrepare, viewportWidth: 400 }),
  );
  const resolvedThreadId = threadId("compact-thread", "test.threadId");
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: resolvedThreadId });
    await pending.promise;
  });

  expect(initialPrepare).not.toHaveBeenCalled();
  expect(initialNavigate).not.toHaveBeenCalled();
  expect(currentPrepare).toHaveBeenCalledWith("server:compact-thread");
  expect(mockNavigateToLinkedThread).toHaveBeenCalledWith("server", resolvedThreadId);
  expect(hook.result.current.chat).toEqual({ status: "closed" });
});

it("uses current wide layout instead of navigating after a compact suggestion request finds a chat", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<EnsureReviewChat>>>();
  const prepareThreadLink = jest.fn();
  mockEnsureReviewChat.mockReturnValue(pending.promise);
  const hook = renderHook(usePullRequestReviewChat, {
    initialProps: reviewChatProps({
      desktop: false,
      prepareThreadLink,
      viewportWidth: 400,
    }),
  });

  act(() => {
    hook.result.current.openReviewChat(null);
  });
  hook.rerender(reviewChatProps({ desktop: true, prepareThreadLink, viewportWidth: 1200 }));
  const resolvedThreadId = threadId("wide-thread", "test.threadId");
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: resolvedThreadId });
    await pending.promise;
  });

  expect(prepareThreadLink).not.toHaveBeenCalled();
  expect(mockNavigateToLinkedThread).not.toHaveBeenCalled();
  expect(hook.result.current.chat).toEqual({ status: "open", threadId: resolvedThreadId });
});
