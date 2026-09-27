import { cleanup, render } from "@testing-library/react-native";
import type { ConnectionHealthStatus } from "../src/data/connectionHealth";
import type { ThreadListServer } from "../src/features/connections/connectionPresentation";
import { ConversationHistorySubtitle } from "../src/features/conversation/ConversationHistoryStatus";

afterEach(cleanup);

function subtitle(health: ConnectionHealthStatus, status: ThreadListServer["status"]) {
  return (
    <ConversationHistorySubtitle
      cwd="/workspace/project"
      model={null}
      resourceId={null}
      server={{ health, iconId: "cloud", id: "home", name: "Home", status }}
    />
  );
}

it("preserves the actual server and folder text across retry and syncing transitions", () => {
  const view = render(subtitle("online", "live"));
  const content = view.getByTestId("conversation-subtitle").props.children;
  expect(content).toEqual(expect.stringContaining("Home"));
  expect(content).toEqual(expect.stringContaining("project"));
  view.rerender(subtitle("online", "connecting"));
  expect(view.getByTestId("conversation-subtitle")).toHaveTextContent(content);
  view.rerender(subtitle("reconnecting", "connecting"));
  expect(view.getByLabelText(content)).toBeVisible();
  view.rerender(subtitle("online", "syncing"));
  expect(view.getByTestId("conversation-subtitle")).toHaveTextContent(content);
  expect(view.queryByText(/Syncing history|History sync failed/)).toBeNull();
  expect(view.queryByText("Connecting…")).toBeNull();
  expect(view.queryByText("Updating…")).toBeNull();
});

it("adds the confirmed cause without replacing the server and folder", () => {
  const view = render(subtitle("online", "live"));
  const content = view.getByTestId("conversation-subtitle").props.children;
  view.rerender(subtitle("noConnection", "offline"));
  expect(view.getByTestId("conversation-subtitle")).toHaveTextContent(
    `${content} · Нет подключения`,
  );
  view.rerender(subtitle("serviceUnavailable", "degraded"));
  expect(view.getByTestId("conversation-subtitle")).toHaveTextContent(
    `${content} · Server unavailable`,
  );
});
