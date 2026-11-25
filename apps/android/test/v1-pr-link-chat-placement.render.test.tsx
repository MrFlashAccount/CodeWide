import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Button } from "react-native";
import { forgeAccountKey, pullRequestKey } from "../src/data/forgeContract";
import { type ForgeLinkTarget, type LinkServer } from "../src/data/forgeLinkTargets";
import { forgeResources } from "../src/data/forgeRuntime";
import { threadId } from "../src/data/reviewContract";
import { workspaceFeatures } from "../src/features/workspace/createWorkspaceFeatures";
import { forgeLinkOptions } from "../src/routeComposition/forgeLinkOptions";
import {
  reviewChatRouteOptions,
  useReviewChatPlacement,
} from "../src/routeComposition/reviewChatPlacement";
import { mockRouterHistory, resetMockRouter } from "./mocks/ExpoRouter";

// Android presents a separate native window above a pointer-transparent host.
jest.mock("../src/ui/AppSheet", () => ({
  AppSheet: jest.requireActual("react-native").View,
  AppSheetScrollView: jest.requireActual("react-native").ScrollView,
}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: { queryClient: new (jest.requireActual("@tanstack/react-query").QueryClient)() },
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: { pullRequestDetail: { ensureReviewChat: jest.fn() } },
}));

const servers: LinkServer[] = ["Studio", "Buddy"].map((id) => ({
  id,
  displayName: id,
  iconId: "desktop",
  enabled: true,
  state: "live",
}));
const url = new URL("https://forge.test/octo/repo/7");
const key = pullRequestKey("selected-account-pr", "fixture");
const target = (server: string): ForgeLinkTarget => ({
  account: forgeAccountKey("account", "fixture"),
  canonical: pullRequestKey("pr", "fixture"),
  connectionId: server,
  login: "coder",
  number: "7",
  provider: "Forge",
  pullRequest: key,
  repository: "octo/repo",
  server,
  serverIconId: "desktop",
});
const ensure = jest.mocked(workspaceFeatures.pullRequestDetail.ensureReviewChat);
const openDraft = jest.fn();
function Harness() {
  const placement = useReviewChatPlacement({
    active: true,
    connectionId: "Studio",
    fromChat: false,
    link: url.href,
    openChat: jest.fn(),
    openDraft,
    prepareThread: jest.fn(),
    pullRequest: key,
    servers,
  });
  return (
    <>
      <Button title="Review chat" onPress={() => placement.open(null)} />
      {placement.picker}
    </>
  );
}

beforeEach(() => {
  resetMockRouter("/pulls");
  ensure.mockReset();
  openDraft.mockClear();
  forgeResources.queryClient.clear();
  forgeResources.queryClient.setQueryData(
    forgeLinkOptions(servers, url, null).queryKey,
    servers.map((server) => target(server.id)),
  );
});

it("opens the existing linked thread on the second server before offering to create another", async () => {
  ensure.mockImplementation(async ({ connectionId }) =>
    connectionId === "Studio"
      ? { kind: "needsWorkspace", candidates: [] }
      : { kind: "ready", created: false, threadId: threadId("existing", "fixture") },
  );
  const view = render(<Harness />);
  fireEvent.press(view.getByRole("button", { name: /review chat/i }));
  await waitFor(() =>
    expect(mockRouterHistory().at(-1)?.params).toMatchObject({
      connectionId: "Buddy",
      threadId: "existing",
      reviewPullRequest: key,
    }),
  );
  expect(openDraft).not.toHaveBeenCalled();
  expect(ensure.mock.calls.map(([, workspace]) => workspace.kind)).toEqual(["ask", "ask"]);
});

it("opens the draft on the chosen server with its own workspace suggestions", async () => {
  ensure.mockImplementation(async ({ connectionId }) => ({
    kind: "needsWorkspace",
    candidates: [{ path: "/" + connectionId, reason: "repository" }],
  }));
  const view = render(<Harness />);
  fireEvent.press(view.getByRole("button", { name: /review chat/i }));
  fireEvent.press(await view.findByRole("button", { name: "Buddy" }));
  expect(mockRouterHistory().at(-1)?.params).toMatchObject({
    connectionId: "Buddy",
    pullRequestKey: key,
    composeReview: "placed",
  });
  expect(reviewChatRouteOptions("placed", { connectionId: "Buddy", pullRequest: key })).toEqual({
    composeReview: true,
    initialProjects: [{ path: "/Buddy", reason: "repository" }],
  });
  expect(openDraft).not.toHaveBeenCalled();
  expect(ensure.mock.calls.map(([, workspace]) => workspace.kind)).toEqual(["ask", "ask"]);
});
