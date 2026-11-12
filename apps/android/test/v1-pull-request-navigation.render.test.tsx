import { act, renderHook } from "@testing-library/react-native";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { threadId } from "../src/data/reviewContract";
import { usePullRequestNavigation } from "../src/routeComposition/pullRequestNavigation";
import { overview91 } from "./fixtures/forgeWireFixtures";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockDismissTo = jest.fn();
const mockPathname = { current: "/pulls" };

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname.current,
  useRouter: () => ({ dismissTo: mockDismissTo, navigate: mockNavigate, push: mockPush }),
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockPush.mockClear();
  mockDismissTo.mockClear();
  mockPathname.current = "/pulls";
});

function fixturePullRequest() {
  const pullRequest = parsePullRequestKeyParam(overview91.pullRequest);
  if (pullRequest === null) {
    throw new Error("The fixture pull-request key is invalid");
  }
  return pullRequest;
}

it("navigates to the canonical linked-thread destination through the parent tabs", () => {
  const hook = renderHook(usePullRequestNavigation);

  act(() => {
    hook.result.current.navigateToLinkedThread(
      "server",
      threadId("linked-thread", "test.threadId"),
    );
  });

  expect(mockNavigate).toHaveBeenCalledWith({
    params: { connectionId: "server", threadId: "linked-thread" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
});

it("publishes the pull-request route immediately without waiting for a preload", () => {
  const pullRequest = fixturePullRequest();
  const hook = renderHook(usePullRequestNavigation);

  act(() => {
    hook.result.current.openPullRequest("server", pullRequest);
  });

  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    params: { connectionId: "server", pullRequestKey: pullRequest },
    pathname: "/pulls/[connectionId]/[pullRequestKey]",
  });
});

it.each(["/pulls/server/other", "/pulls/server/other/changes"])(
  "replaces the shown pull request from %s instead of stacking another one",
  (pathname) => {
    mockPathname.current = pathname;
    const pullRequest = fixturePullRequest();
    const hook = renderHook(usePullRequestNavigation);

    act(() => {
      hook.result.current.openPullRequest("server", pullRequest);
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDismissTo).toHaveBeenCalledWith({
      params: { connectionId: "server", pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
  },
);
