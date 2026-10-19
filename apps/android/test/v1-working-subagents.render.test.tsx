import { fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { WorkingSubagentsMenu } from "../src/features/agents/WorkingSubagentsMenu";
import { layOutContentMenus } from "./fixtures/contentMenuLayout";

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

it("shows the working children as one floating chip whose list opens each of them", () => {
  const children = [
    child("a", "Map sources", true),
    child("b", "Review spec", true),
    child("c", "Old audit", false),
  ];
  const opened: string[] = [];
  const view = render(
    <WorkingSubagentsMenu
      onOpen={(threadId) => {
        opened.push(threadId);
      }}
      working={children.filter((summary) => summary.status.type === "active")}
    />,
  );

  expect(view.getByText("2 working")).toBeOnTheScreen();
  fireEvent.press(view.getByTestId("working-subagents-chip"));
  const rows = view.getAllByTestId("working-subagent-row");
  // Only the working agents: no row for every subagent.
  expect(rows).toHaveLength(2);
  expect(view.queryByText(/All subagents/u)).toBeNull();
  fireEvent.press(rows[1]!);
  expect(opened).toEqual(["b"]);
});

it("floats nothing while no subagent works", () => {
  const view = render(<WorkingSubagentsMenu onOpen={() => undefined} working={[]} />);

  expect(view.queryByTestId("working-subagents-chip")).toBeNull();
});

it("opens the list centred on the chip with a gap, and draws no arrows", () => {
  const view = render(
    <WorkingSubagentsMenu
      onOpen={() => undefined}
      working={[child("a", "Map sources", true)]}
    />,
  );
  fireEvent.press(view.getByTestId("working-subagents-chip"));
  layOutContentMenus(view);

  // Compose lines the menu up with its anchor from its own layout pass; the
  // trigger is not measured or wrapped on the React Native side.
  const menu = view.UNSAFE_getByProps({ expanded: true });
  expect(menu.props.horizontalAlignment).toBe("center");
  expect(menu.props.offsetY).toBe(8);
  expect(menu.props.offsetX).toBeUndefined();
  expect(view.UNSAFE_queryAllByType(View).some((node) => node.props.onLayout)).toBe(false);
  expect(view.queryByText(/chevron/u)).toBeNull();
});
