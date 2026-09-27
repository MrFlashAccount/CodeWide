import { render } from "@testing-library/react-native";

import type { StoredConnection } from "../src/data/connection-profile-types";
import { connectionSettingsSections } from "../src/features/connections/ConnectionFeature";
import { ThreadRowContent } from "../src/features/threadList/ThreadRowContent";

const connection: StoredConnection = {
  displayName: "Cloud host",
  enabled: true,
  endpoint: "wss://example.test/v1/sync",
  iconId: "cloud",
  id: "server",
  lastError: null,
  lastErrorAt: null,
  sortOrder: 0,
  state: "live",
  token: "",
};

it("renders the same server icon in settings and thread-list projections", () => {
  const sections = connectionSettingsSections({
    accountRateLimits: [],
    connections: [connection],
    onDelete: jest.fn(async () => undefined),
    onReconnect: jest.fn(async () => undefined),
    onToggle: jest.fn(async () => undefined),
    onUpdate: jest.fn(async () => undefined),
  });
  const settingsIcon = render(sections[0]?.leading);
  expect(settingsIcon.getByText("cloud-outline")).toBeTruthy();

  const thread = render(
    <ThreadRowContent
      selected={false}
      server={{ iconId: "cloud", id: "server", name: "Cloud host", status: "live" }}
      thread={{
        id: "thread",
        pinned: false,
        preview: "Ready",
        serverId: "server",
        title: "Thread",
        unread: 0,
      }}
    />,
  );
  expect(thread.getByLabelText("Server Cloud host")).toBeTruthy();
  expect(thread.getByText("cloud-outline")).toBeTruthy();
});
