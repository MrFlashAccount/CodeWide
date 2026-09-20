import { connectionId } from "@codewide/domain";
import { toRenderBlock } from "@codewide/renderers";
import { render } from "@testing-library/react-native";

import { OptimisticTurn } from "../src/features/conversation/turns/OptimisticTurn";
import { PreTurnLifecycleRows } from "../src/features/conversation/turns/PreTurnLifecycleRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";

type OptimisticItem = Extract<TimelineItem, { kind: "optimistic" }>;

function optimisticItem(status: OptimisticItem["status"]): OptimisticItem {
  return {
    attachments: [],
    createdAt: 1_750_000_000_000,
    id: "command-1",
    kind: "optimistic",
    lastError: null,
    scope: "server/thread",
    status,
    text: "Continue the task",
  };
}

function compactionBlock(phase: "completed" | "started") {
  return toRenderBlock({
    connectionId: connectionId("server"),
    itemId: "compaction",
    key: `server/thread/turn/compaction/${phase}`,
    payload: {
      codewideLifecyclePhase: phase,
      id: "compaction",
      type: "contextCompaction",
    },
    threadId: "thread",
    turnId: "turn",
    type: "contextCompaction",
    unknown: false,
  });
}

it("stops presenting an App Server-accepted message as pending", () => {
  const view = render(<OptimisticTurn item={optimisticItem("sending")} />);

  expect(view.getByTestId("pending-user-message-shimmer")).toBeTruthy();
  expect(view.getByLabelText("Message sending to companion")).toBeTruthy();

  view.rerender(<OptimisticTurn item={optimisticItem("appServerAccepted")} />);

  expect(view.queryByTestId("pending-user-message-shimmer")).toBeNull();
  expect(view.getByLabelText("Message sent")).toBeTruthy();
  expect(view.getByText("Continue the task")).toBeTruthy();
});

it("shows compaction as a separate running lifecycle until completion", () => {
  const view = render(
    <PreTurnLifecycleRows
      blocks={[compactionBlock("started")]}
      turnKey="server/thread/turn"
      turnStatus="inProgress"
    />,
  );

  expect(view.getByLabelText("Compacting context, running")).toBeTruthy();
  expect(view.getByTestId("calm-running-spinner")).toBeTruthy();

  view.rerender(
    <PreTurnLifecycleRows
      blocks={[compactionBlock("completed")]}
      turnKey="server/thread/turn"
      turnStatus="inProgress"
    />,
  );

  expect(view.getByLabelText("Context compacted, completed")).toBeTruthy();
  expect(view.queryByTestId("calm-running-spinner")).toBeNull();
});
