import { act, renderHook } from "@testing-library/react-native";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { usePullRequestNavigation } from "../src/routeComposition/pullRequestNavigation";
import { overview91 } from "./fixtures/forgeWireFixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

it("publishes the pull-request route immediately without waiting for a preload", () => {
  const pullRequest = parsePullRequestKeyParam(overview91.pullRequest);
  if (pullRequest === null) {
    throw new Error("The fixture pull-request key is invalid");
  }
  const hook = renderHook(usePullRequestNavigation);

  act(() => {
    hook.result.current.openPullRequest("server", pullRequest);
  });

  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    params: { connectionId: "server", pullRequestKey: pullRequest },
    pathname: "/pulls/[connectionId]/[pullRequestKey]",
  });
});
