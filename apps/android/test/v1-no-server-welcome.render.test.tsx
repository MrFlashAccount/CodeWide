import { fireEvent, render } from "@testing-library/react-native";

import { createConnectionProfileDatabase } from "../src/data/connection-profile-database.web";
import type { WorkspaceRuntimeSnapshot } from "../src/data/workspace-runtime";
import { NoServerWelcome } from "../src/features/threadList/NoServerWelcome";
import { isNoServerWorkspace } from "../src/routeComposition/noServerWorkspace";

it("shows the connection action and passes its press to the pairing flow", () => {
  const onConnect = jest.fn();
  const view = render(<NoServerWelcome onConnect={onConnect} />);

  expect(view.getByText("Welcome to CodeWide")).toBeTruthy();
  fireEvent.press(view.getByRole("button", { name: "Connect a server" }));

  expect(onConnect).toHaveBeenCalledTimes(1);
});

it("shows welcome only after the saved server collection has hydrated empty", () => {
  const profiles = createConnectionProfileDatabase();
  const runtime: WorkspaceRuntimeSnapshot = {
    accountRateLimits: null,
    connectionProfiles: profiles,
    connectionState: null,
    error: null,
    pendingRequests: null,
    ready: false,
    resources: null,
    threadDetails: null,
    threadSummaries: null,
    threadUiState: null,
  };

  expect(isNoServerWorkspace(runtime)).toBe(false);
  expect(isNoServerWorkspace({ ...runtime, ready: true })).toBe(true);
  profiles.collection.insert({
    displayName: "Home",
    emoji: "🖥️",
    enabled: true,
    endpoint: "https://example.com",
    id: "home",
    sortOrder: 0,
    tlsPinSha256: "",
    updatedAt: 0,
  });
  expect(isNoServerWorkspace({ ...runtime, ready: true })).toBe(false);
  profiles.close();
});
