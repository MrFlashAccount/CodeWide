import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RenderBlock } from "@codewide/renderers";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { CollapsedTurnActivity } from "../src/features/conversation/turns/CompletedTurnHistory";
import { TurnActivitySegment } from "../src/features/conversation/turns/TurnActivity";
import { persistentExpansionStates } from "../src/features/conversation/turns/disclosureState";

// WHY: Node cannot mount the native bottom-sheet window. Keep the real Activity header and list.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

const commandBlock: RenderBlock = {
  body: "done",
  collapsible: true,
  content: null,
  durationMs: 10,
  key: "command:command",
  kind: "commandExecution",
  raw: { command: "printf done", id: "command", status: "completed", type: "commandExecution" },
  status: "completed",
  title: "printf done",
  tone: "success",
};

const command: Turn["items"][number] = {
  aggregatedOutput: "done",
  command: "printf done",
  commandActions: [],
  cwd: "/workspace",
  durationMs: 10,
  exitCode: 0,
  id: "command",
  processId: null,
  source: "agent",
  status: "completed",
  type: "commandExecution",
};

function runningTurn(): Extract<TimelineItem, { kind: "turn" }> {
  return {
    connectionId: "server",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn",
      items: [command],
      itemsView: "full",
      startedAt: 1,
      status: "inProgress",
    },
  };
}

beforeEach(() => {
  persistentExpansionStates.clear();
});

it("opens a finished tool group of a running turn in the sheet instead of expanding it", () => {
  const view = render(
    <TurnActivitySegment
      animateNew={false}
      compact
      forceExpanded={false}
      part={{ blocks: [commandBlock], followedByAgent: true, key: "activity", kind: "activity" }}
      turnKey="server/thread/turn"
      turnStatus="inProgress"
    />,
  );

  const row = view.getByRole("button", { name: /^Open activity/ });
  fireEvent.press(row);
  expect(view.queryByRole("button", { name: /^(Expand|Collapse) activity/ })).toBeNull();
  expect(view.queryByTestId("turn-activity-list")).toBeNull();
});

it("keeps disclosing the same group inline once its turn has finished", () => {
  const view = render(
    <TurnActivitySegment
      animateNew={false}
      compact
      forceExpanded={false}
      part={{ blocks: [commandBlock], followedByAgent: true, key: "activity", kind: "activity" }}
      turnKey="server/thread/turn"
      turnStatus="completed"
    />,
  );

  fireEvent.press(view.getByRole("button", { name: /^Expand activity/ }));
  expect(view.getByTestId("turn-activity-list")).toBeOnTheScreen();
});

it("opens the collapsed earlier activity of a running turn in the sheet", () => {
  const view = render(
    <CollapsedTurnActivity compact forceExpanded={false} indexes={[0]} item={runningTurn()} />,
  );

  fireEvent.press(view.getByRole("button", { name: /^Open activity/ }));
  expect(view.queryByTestId("turn-activity-list")).toBeNull();
  expect(view.getByRole("header", { name: "Activity" })).toBeOnTheScreen();
});
