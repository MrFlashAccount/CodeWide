import { fireEvent, render } from "@testing-library/react-native";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { WorkingSubagentsMenu } from "../src/features/agents/WorkingSubagentsMenu";

function child(id: string, name: string, active: boolean): StoredThreadSummary {
  return {
    agentNickname: name,
    agentRole: "worker",
    archived: false,
    connectionId: "buddy",
    cwd: "/repo",
    deleteCommandId: null,
    lastSeenCursor: 1,
    latestActivityCursor: 2,
    name,
    parentThreadId: "parent",
    pendingRequestCount: 0,
    pinned: false,
    preview: "",
    recencyAt: null,
    remoteThreadId: id,
    status: active ? { activeFlags: [], type: "active" } : { type: "idle" },
    unread: 0,
    updatedAt: 1_787_000_000,
  };
}

it("shows the working children as one floating chip that opens them and every subagent", () => {
  const children = [
    child("a", "Map sources", true),
    child("b", "Review spec", true),
    child("c", "Old audit", false),
  ];
  const opened: (string | null)[] = [];
  const view = render(
    <WorkingSubagentsMenu
      onOpen={(threadId) => {
        opened.push(threadId);
      }}
      total={children.length}
      working={children.filter((summary) => summary.status.type === "active")}
    />,
  );

  expect(view.getByText("2 working")).toBeOnTheScreen();
  fireEvent.press(view.getByTestId("working-subagents-chip"));
  const rows = view.getAllByTestId("working-subagent-row");
  expect(rows).toHaveLength(2);
  fireEvent.press(rows[1]!);
  fireEvent.press(view.getByTestId("working-subagents-chip"));
  expect(view.getByText("All subagents · 3")).toBeOnTheScreen();
  fireEvent.press(view.getByTestId("all-subagents-row"));
  expect(opened).toEqual(["b", null]);
});

it("floats nothing while no subagent works", () => {
  const view = render(<WorkingSubagentsMenu onOpen={() => undefined} total={1} working={[]} />);

  expect(view.queryByTestId("working-subagents-chip")).toBeNull();
});
