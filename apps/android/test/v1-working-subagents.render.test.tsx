import { fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { WorkingSubagentsMenu } from "../src/features/agents/WorkingSubagentsMenu";
import { ContentMenu } from "../src/ui/ContentMenu";

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

it("opens the list centred above the chip with a gap, and draws no arrows", () => {
  const view = render(
    <WorkingSubagentsMenu
      onOpen={() => undefined}
      total={1}
      working={[child("a", "Map sources", true)]}
    />,
  );
  const chip = view.getByTestId("working-subagents-chip");
  // The chip's measured width centres the wider menu on it.
  fireEvent(view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout)!, "layout", {
    nativeEvent: { layout: { height: 32, width: 120, x: 0, y: 0 } },
  });
  fireEvent.press(chip);

  const menuWidth: unknown = view.UNSAFE_getByType(ContentMenu).props.width;
  expect(typeof menuWidth).toBe("number");
  const menu = view.UNSAFE_getByProps({ expanded: true });
  expect(menu.props.offsetX).toBe((120 - Number(menuWidth)) / 2);
  expect(menu.props.offsetY).toBe(8);
  expect(view.queryByText(/chevron/u)).toBeNull();
});
