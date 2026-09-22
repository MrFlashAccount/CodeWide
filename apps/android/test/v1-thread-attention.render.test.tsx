import { useSelector } from "@legendapp/state/react";
import { createThreadSummaryModel } from "../src/data/thread-summary-model";
import { projectQuestionAnswerDelivery } from "../src/data/questionAnswerProjection";
import { ThreadListProjection } from "../src/features/threadList/summaryProjection";
import { ThreadListItemProjection } from "../src/features/threadList/threadListProjection";
import { questionAnswerDelivery } from "./fixtures/questionAnswer";
import { summary } from "./fixtures/thread-summary";
import { act, render } from "@testing-library/react-native";
import { ThreadRowContent } from "../src/features/threadList/ThreadRowContent";

it("shows the hand in the unread slot and restores the unread dot after resolution", () => {
  const thread = { id: "thread", serverId: "server", title: "Thread", preview: "Preview", pinned: false, unread: 1 };
  const view = render(<ThreadRowContent selected={false} thread={{ ...thread, needsAttention: true }} />);
  expect(view.getByLabelText("Требуется твоё внимание")).toBeOnTheScreen();
  expect(view.queryByLabelText("1 unread message")).toBeNull();
  view.rerender(<ThreadRowContent selected={false} thread={{ ...thread, needsAttention: false }} />);
  expect(view.queryByLabelText("Требуется твоё внимание")).toBeNull();
  expect(view.getByLabelText("1 unread message")).toBeOnTheScreen();
  view.rerender(<ThreadRowContent selected={false} thread={{ ...thread, unread: 0, needsAttention: true }} />);
  expect(view.getByLabelText("Требуется твоё внимание")).toBeOnTheScreen();
});


it("reacts to the published answer row while the turn stays active without remount or refresh", () => {
  const model = createThreadSummaryModel();
  const request = { viewId: "attention-test", connectionId: "server", archivedLimit: 0, recentLimit: 10, selectedConnectionId: null, selectedThreadId: null, subagentConnectionId: null, subagentLimit: 0 };
  const row = summary("question-thread", { unread: 1, pendingQuestion: { turnId: "turn", itemIds: ["question"] }, status: { type: "active", activeFlags: [] } });
  const generation = model.startView(request);
  model.commitView(request, generation, { recent: [row], pinned: [], archived: [], selected: [], subagents: [] });
  const projection = new ThreadListProjection();
  const items = new ThreadListItemProjection();
  const snapshot = model.view$(request);
  function PublishedRow() {
    const current = useSelector(() => snapshot.get());
    const item = items.project(projection.project(current.recent, []))[0];
    return item === undefined ? null : <ThreadRowContent selected={false} thread={item} />;
  }
  const view = render(<PublishedRow />);
  expect(view.getByLabelText("Требуется твоё внимание")).toBeOnTheScreen();
  const submitted = projectQuestionAnswerDelivery(row, questionAnswerDelivery());
  act(() => { model.publish([{ type: "update", value: submitted }]); });
  expect(view.queryByLabelText("Требуется твоё внимание")).toBeNull();
  expect(view.getByLabelText("1 unread message")).toBeOnTheScreen();
  expect(submitted.status.type).toBe("active");
  act(() => { model.publish([{ type: "update", value: projectQuestionAnswerDelivery(submitted, questionAnswerDelivery("failed")) }]); });
  expect(view.getByLabelText("Требуется твоё внимание")).toBeOnTheScreen();
  view.unmount();
  model.close();
});
