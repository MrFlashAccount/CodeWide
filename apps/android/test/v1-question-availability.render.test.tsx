import { render } from "@testing-library/react-native";
import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";

import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";
import {
  QuestionConversationProvider,
  QuestionDock,
} from "../src/features/requests/QuestionFeature";

let mockSummaryView: {
  phase: "error" | "loading" | "ready";
  selected: { skippedQuestions: { itemIds: string[]; turnId: string } | null }[];
} = { phase: "loading", selected: [] };

jest.mock("../src/data/use-thread-summary-view", () => ({
  useThreadSummaryView: () => mockSummaryView,
}));
jest.mock("../src/data/thread-summary-database.native", () => ({
  createThreadSummaryDatabase: () => ({ close: () => undefined }),
}));
jest.mock("../src/data/questionDraftStorage", () => ({
  readQuestionDraft: async () => null,
  writeQuestionDraft: async () => undefined,
}));

it("shows a live async question while its separate catalog view loads, then honors Skip", async () => {
  const turn: Turn = {
    completedAt: null,
    durationMs: null,
    error: null,
    id: "active-turn",
    items: [
      { clientId: null, content: [], id: "prompt", type: "userMessage" },
      {
        delivery: "async",
        id: "question",
        memoryCitation: null,
        phase: "final_answer",
        questions: [{ options: ["Да", "Нет"], title: "Продолжать?" }],
        text: "Продолжать?",
        type: "agentMessage",
      },
    ],
    itemsView: "full",
    startedAt: null,
    status: "inProgress",
  };
  const summaries = createThreadSummaryDatabase();
  const value = {
    activeTurnId: turn.id,
    connectionId: "server",
    entries: [{ kind: "turn" as const, turn }],
    latestHistoryPresent: true,
    onRespond: undefined,
    pendingRequest: null,
    sendAnswer: async () => undefined,
    summaries,
    threadId: "thread",
  };
  const screen = render(
    <QuestionConversationProvider value={value}>
      <QuestionDock />
    </QuestionConversationProvider>,
  );
  expect(await screen.findByText("Продолжать?")).toBeOnTheScreen();

  mockSummaryView = { phase: "error", selected: [] };
  screen.rerender(
    <QuestionConversationProvider value={{ ...value }}>
      <QuestionDock />
    </QuestionConversationProvider>,
  );
  expect(screen.getByText("Продолжать?")).toBeOnTheScreen();

  mockSummaryView = {
    phase: "ready",
    selected: [{ skippedQuestions: { itemIds: ["question"], turnId: turn.id } }],
  };
  screen.rerender(
    <QuestionConversationProvider value={{ ...value }}>
      <QuestionDock />
    </QuestionConversationProvider>,
  );
  expect(screen.queryByTestId("question-dock")).toBeNull();
  screen.unmount();
  summaries.close();
});
