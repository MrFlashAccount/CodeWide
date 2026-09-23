import { QuestionConversationProvider, RpcQuestionCard, QuestionDock } from "../src/features/requests/QuestionFeature";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QuestionCard } from "../src/features/requests/questions/QuestionCard";
import { answerText, questionReply, rpcQuestions, type QuestionInteraction } from "../src/features/requests/questions/questionContract";
import { loadQuestionSession } from "../src/features/requests/questions/questionSession";
import { readQuestionDraft, writeQuestionDraft } from "../src/data/questionDraftStorage";
import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { View } from "react-native";
import { ConversationBottomChrome } from "../src/features/conversation/ConversationBottomChrome";
import { projectTimelineTurns } from "../src/features/conversation/timeline/timelineProjection";
import { selectTurnRenderWindow } from "../src/rendering/thread-render-window";
import { createV1TestThread } from "./fixtures/v1Thread";

jest.mock("../src/data/questionDraftStorage", () => ({
  readQuestionDraft: jest.fn(async () => null), writeQuestionDraft: jest.fn(async () => undefined),
}));
let sequence = 0;
function interaction(secret = false): QuestionInteraction {
  sequence += 1;
  return { key: `form-${sequence}`, transport: { kind: "message", itemId: "call", turnId: "turn" }, questions: [
    { id: "first", title: "Как продолжить?", secret, options: [{ label: "Сразу", description: "Начать работу сейчас" }, { label: "Позже", description: "Дождаться результата" }] },
    { id: "second", title: "Какие ограничения?", secret: false, options: [] },
  ] };
}

it("retains choices and custom drafts across pages and remount, submits all answers only explicitly", async () => {
  const source = interaction();
  const send = jest.fn(async () => undefined);
  const props = { interaction: source, send, delivered: false, failed: false, canSend: true, statusText: "Агент продолжает работу" };
  const screen = render(<QuestionCard {...props} />);
  await screen.findByText("Как продолжить?");
  fireEvent(screen.getByPlaceholderText("Свой ответ"), "focus");
  fireEvent.changeText(screen.getByLabelText("Как продолжить?"), "После проверки");
  fireEvent.press(screen.getByText("Сразу"));
  fireEvent.press(screen.getByText("Далее"));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Отправить ответы" })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText("Какие ограничения?"), "Без публикации");
  fireEvent.press(screen.getByText("Назад"));
  fireEvent(screen.getByPlaceholderText("Свой ответ"), "focus");
  expect(screen.getByDisplayValue("После проверки")).toBeOnTheScreen();
  screen.unmount();
  const restored = render(<QuestionCard {...props} />);
  expect(await restored.findByDisplayValue("После проверки")).toBeOnTheScreen();
  fireEvent.press(restored.getByText("Далее"));
  fireEvent.press(restored.getByText("Отправить ответы"));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]?.[0]).toEqual([{ selected: null, custom: "После проверки" }, { selected: null, custom: "Без публикации" }]);
  expect(await restored.findByText("Ответ в очереди")).toBeOnTheScreen();
  expect(restored.queryByText("Ответы доставлены")).toBeNull();
  restored.rerender(<QuestionCard {...props} delivered />);
  await waitFor(() => expect(restored.queryByTestId("question-card")).toBeNull());
});

it("locks duplicate submits and retries the exact answer after rejection", async () => {
  const source = interaction();
  const session = await loadQuestionSession(source);
  session.setDraft(0, { selected: 0, custom: "draft" });
  session.setDraft(1, { selected: null, custom: "limit" });
  const failed = jest.fn(async () => { throw new Error("offline"); });
  await session.submit(failed);
  expect(session.state$.peek().delivery.status).toBe("failed");
  const retried = jest.fn(async () => undefined);
  await session.submit(retried);
  await session.submit(retried);
  expect(retried).toHaveBeenCalledTimes(1);
  expect(retried).toHaveBeenCalledWith(session.state$.peek().drafts, true);
});

it("never writes or restores secret answers", async () => {
  const source = interaction(true);
  const session = await loadQuestionSession(source);
  session.setDraft(0, { selected: null, custom: "private-secret" });
  session.setDraft(1, { selected: null, custom: "ordinary" });
  await session.submit(async () => undefined);
  expect(jest.mocked(writeQuestionDraft).mock.calls.filter(([key]) => key === source.key).every(([, value]) => !value.includes("private-secret"))).toBe(true);
  jest.mocked(readQuestionDraft).mockResolvedValueOnce(JSON.stringify({ drafts: [{ custom: "private-secret", selected: 0 }] }));
  const restored = await loadQuestionSession(source);
  expect(restored.state$.peek().drafts[0]).toEqual({ custom: "", selected: null });
});

it("validates RPC ids and encodes question framing with bounded Unicode text", () => {
  const request = { connectionId: "server", requestId: 1, requestKey: "key", state: "pending" as const, createdAt: 0, method: "item/tool/requestUserInput", params: { questions: [{ id: "q", question: "Pick", options: null }] } };
  expect(rpcQuestions(request)?.transport).toMatchObject({ kind: "rpc", blocking: true });
  expect(rpcQuestions({ ...request, params: { questions: [{ question: "Missing id" }] } })).toBeNull();
  const question = { id: "q", title: "я".repeat(300), secret: false, options: [] };
  const draft = { selected: null, custom: "Ответ" };
  expect(answerText(question, draft)).toBe("Ответ");
  expect(questionReply([question], [draft])).toBe(`> ${"я".repeat(256)}\n\nОтвет`);
});

it("routes Astra answers as a steer and hides the dock after the conversation moves on", async () => {
  const turn = {
    id: "async-turn", status: "inProgress" as const, itemsView: "full" as const, error: null, startedAt: null, completedAt: null, durationMs: null,
    items: [{ type: "agentMessage" as const, id: "async-call", text: "Выбери способ", phase: "final_answer" as const, delivery: "async" as const, memoryCitation: null, questions: [{ title: "Выбери способ", options: ["Сохранить", "Пропустить"] }] }],
  };
  const sendAnswer = jest.fn(async (_request: Parameters<import("../src/features/requests/workspaceCapabilities").RequestsWorkspaceCapabilities["sendQuestionAnswer"]>[0]) => undefined);
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "async-thread", activeTurnId: turn.id, entries: [{ kind: "turn" as const, turn }], pendingRequest: null, onRespond: undefined, sendAnswer };
  const screen = render(<QuestionConversationProvider value={value}><QuestionDock /></QuestionConversationProvider>);
  await screen.findByText("Сохранить");
  fireEvent.press(screen.getByRole("button", { name: "Ответить" }));
  await waitFor(() => expect(sendAnswer).toHaveBeenCalledTimes(1));
  const command = sendAnswer.mock.calls[0]?.[0];
  expect(command).toMatchObject({ mode: { type: "steer", expectedTurnId: "async-turn" }, text: "> Выбери способ\n\nСохранить" });
  const unrelatedTurn = { ...turn, id: "unrelated", items: [{ type: "userMessage" as const, id: "unrelated-message", clientId: "unrelated-client", content: [{ type: "text" as const, text: "Продолжай", text_elements: [] }] }] };
  const completed = { ...turn, status: "completed" as const };
  screen.rerender(<QuestionConversationProvider value={{ ...value, activeTurnId: null, entries: [{ kind: "turn", turn: completed }, { kind: "turn", turn: unrelatedTurn }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(screen.queryByText("Ответ доставлен")).toBeNull();
  const receipt = { ...unrelatedTurn, items: [{ ...unrelatedTurn.items[0], clientId: command?.commandId }] };
  screen.rerender(<QuestionConversationProvider value={{ ...value, entries: [{ kind: "turn", turn: completed }, { kind: "turn", turn: receipt }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(screen.queryByText(/Ответ записан/)).toBeNull();
  expect(screen.queryByText(/Вопрос в истории/)).toBeNull();
  expect(screen.queryByText("Продолжай")).toBeNull();
});

it("keeps an active-turn question visible when older activity is collapsed", async () => {
  const turn: Turn = {
    id: "busy-turn", status: "inProgress", itemsView: "full", error: null,
    startedAt: null, completedAt: null, durationMs: null,
    items: [
      { type: "userMessage", id: "prompt", clientId: null, content: [] },
      ...Array.from({ length: 20 }, (_, index) => ({
        type: "plan" as const, id: `activity-${index}`, text: `Step ${index}`,
      })),
      { type: "agentMessage", id: "question", text: "Choose", phase: "final_answer",
        delivery: "async", memoryCitation: null,
        questions: [{ title: "Куда продолжить?", options: ["Здесь", "Там"] }] },
    ],
  };
  const window = selectTurnRenderWindow(turn);
  expect(window.collapsedActivityIndexes).toHaveLength(4);
  expect(window.collapsedActivityIndexes).not.toContain(turn.items.length - 1);
  const thread = createV1TestThread("busy-thread", null, 1, [turn]);
  const timeline = projectTimelineTurns([turn], "scope", "server", thread.id);
  const chrome = (
    <ConversationBottomChrome
      composerContent={<View />}
      currentOutcome={null}
      failureNotice={null}
      readOnly={false}
      remoteThread={thread}
      requestPrompt={null}
      setBottomChromeHeight={jest.fn()}
      timeline={timeline}
    />
  );
  const value = {
    latestHistoryPresent: true, connectionId: "server", threadId: thread.id,
    activeTurnId: turn.id, entries: [{ kind: "turn" as const, turn }],
    pendingRequest: null, onRespond: undefined,
    sendAnswer: jest.fn(async () => undefined),
  };
  const screen = render(<QuestionConversationProvider value={value}>{chrome}</QuestionConversationProvider>);
  expect(await screen.findByText("Куда продолжить?")).toBeOnTheScreen();
  expect(screen.getByTestId("question-dock")).toBeOnTheScreen();

  const request = {
    connectionId: "server", requestId: "rpc", requestKey: "rpc", state: "pending" as const,
    createdAt: 1, method: "item/tool/requestUserInput",
    params: { threadId: thread.id, turnId: turn.id, itemId: "activity-0",
      questions: [{ id: "q", question: "Как действовать?", options: null }] },
  };
  screen.rerender(
    <QuestionConversationProvider value={{ ...value, pendingRequest: request }}>
      {chrome}
    </QuestionConversationProvider>,
  );
  expect(await screen.findByText("Как действовать?")).toBeOnTheScreen();
  expect(screen.getAllByTestId("question-card")).toHaveLength(1);
});

it("returns legacy answers to the original RPC request with question ids", async () => {
  const request = { connectionId: "server", requestId: "rpc-23", requestKey: "rpc-test", state: "pending" as const, createdAt: 0, method: "item/tool/requestUserInput", params: { isBlocking: true, questions: [{ id: "where", question: "Где сохранить?", options: [{ label: "Локально", description: "На этом устройстве" }] }] } };
  const respond = jest.fn(async () => undefined);
  const screen = render(<RpcQuestionCard request={request} onRespond={respond} />);
  expect(await screen.findByLabelText("Агент ждёт ответа")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Ответить" }));
  await waitFor(() => expect(respond).toHaveBeenCalledWith(request, { answers: { where: { answers: ["Локально"] } } }));
});

it("publishes every typed character and option immediately without waiting for storage", async () => {
  const source = interaction();
  const screen = render(<QuestionCard interaction={source} canSend delivered={false} failed={false} send={async () => undefined} statusText="Можно ответить" />);
  await screen.findByText("Как продолжить?");
  fireEvent(screen.getByPlaceholderText("Свой ответ"), "focus");
  for (const text of ["П", "Пр", "Про", "Произвольный ответ"]) {
    fireEvent.changeText(screen.getByLabelText("Как продолжить?"), text);
    expect(screen.getByLabelText("Как продолжить?").props.value).toBe(text);
  }
  fireEvent.press(screen.getByText("Позже"));
  expect(screen.getByRole("radio", { name: /Позже/, checked: true })).toBeOnTheScreen();
  fireEvent(screen.getByPlaceholderText("Свой ответ"), "focus");
  expect(screen.getByDisplayValue("Произвольный ответ")).toBeOnTheScreen();
});

it("retires the live RPC form from rollout evidence even while its pending request remains", async () => {
  const request = { connectionId: "server", requestId: "rollout-rpc", requestKey: "rollout-rpc", state: "pending" as const, createdAt: 1, method: "item/tool/requestUserInput", params: { turnId: "rollout-turn", itemId: "rollout-call", questions: [{ id: "q", question: "Куда записать?", options: [{ label: "На диск", description: "Локально" }] }] } };
  const source = { itemId: "rollout-call", questions: [{ id: "q", title: "Куда записать?", secret: false, options: [{ label: "На диск", description: "Локально" }] }], outcome: { status: "unconfirmed" as const } };
  const turn = { id: "rollout-turn", status: "inProgress" as const, itemsView: "summary" as const, items: [], error: null, startedAt: null, completedAt: null, durationMs: null, codewide: { questions: [source] } };
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "rollout-thread", activeTurnId: turn.id, entries: [{ kind: "turn" as const, turn }], pendingRequest: request, onRespond: jest.fn(async () => undefined), sendAnswer: undefined };
  const screen = render(<QuestionConversationProvider value={value}><QuestionDock /></QuestionConversationProvider>);
  await screen.findByText("Куда записать?");
  expect(screen.getAllByTestId("question-card")).toHaveLength(1);
  expect(screen.queryByTestId("question-history-card")).toBeNull();
  const closed = { ...turn, status: "completed" as const };
  screen.rerender(<QuestionConversationProvider value={{ ...value, entries: [{ kind: "turn", turn: closed }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(screen.queryByTestId("question-card")).toBeNull();
  expect(screen.queryByText(/Вопрос в истории/)).toBeNull();
  const answered = { ...turn, codewide: { questions: [{ ...source, outcome: { status: "answered", answers: [{ questionId: "q", answer: { kind: "text", values: ["Ответ с другого устройства"] } }] } }] } };
  screen.rerender(<QuestionConversationProvider value={{ ...value, entries: [{ kind: "turn", turn: answered }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(screen.queryByTestId("question-card")).toBeNull();
  expect(screen.queryByTestId("question-history-card")).toBeNull();
  expect(screen.queryByText(/Ответ записан/)).toBeNull();
  expect(screen.queryByText(/Вопрос в истории/)).toBeNull();
  expect(screen.queryByText("Ответ с другого устройства")).toBeNull();
  screen.unmount();
  const restored = render(<QuestionConversationProvider value={{ ...value, entries: [{ kind: "turn", turn: answered }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(restored.queryByTestId("question-dock")).toBeNull();
  expect(restored.queryByText("Ответ с другого устройства")).toBeNull();
});

it("does not show a question dock for interrupted rollout history", () => {
  const turn = { id: "cancelled-turn", status: "interrupted" as const, itemsView: "summary" as const, items: [], error: null, startedAt: null, completedAt: null, durationMs: null, codewide: { questions: [{ itemId: "cancelled-call", questions: [{ id: "q", title: "Продолжить?", secret: false, options: [] }], outcome: { status: "unconfirmed" } }] } };
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "thread", activeTurnId: null, entries: [{ kind: "turn" as const, turn }], pendingRequest: null, onRespond: undefined, sendAnswer: undefined };
  const screen = render(<QuestionConversationProvider value={value}><QuestionDock /></QuestionConversationProvider>);
  expect(screen.queryByTestId("question-dock")).toBeNull();
  expect(screen.queryByText(/Вопрос в истории/)).toBeNull();
  expect(screen.queryByText("Ответ доставлен")).toBeNull();
  expect(screen.queryByRole("button", { name: "Ответить" })).toBeNull();
});

it("retires an unanswered old message when the conversation moves on without marking it answered", async () => {
  const turn = {
    id: "old-question-turn", status: "inProgress" as const, itemsView: "full" as const,
    error: null, startedAt: null, completedAt: null, durationMs: null,
    items: [{ type: "agentMessage" as const, id: "old-question", text: "Pick", phase: null,
      memoryCitation: null, delivery: "async" as const, questions: [{ title: "Выбери место", options: ["Здесь", "Там"] }] }],
  };
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "expiry-thread", activeTurnId: null,
    entries: [{ kind: "turn" as const, turn }], pendingRequest: null, onRespond: undefined,
    sendAnswer: jest.fn(async () => undefined) };
  const content = <QuestionDock />;
  const screen = render(<QuestionConversationProvider value={value}>{content}</QuestionConversationProvider>);
  expect(await screen.findByRole("radio", { name: /Здесь/ })).toBeOnTheScreen();
  expect(screen.getAllByTestId("question-card")).toHaveLength(1);
  screen.rerender(<QuestionConversationProvider value={{ ...value, latestHistoryPresent: false }}>{content}</QuestionConversationProvider>);
  expect(screen.queryByTestId("question-dock")).toBeNull();
  const next = { ...turn, id: "newer-turn", items: [] };
  screen.rerender(<QuestionConversationProvider value={{ ...value, entries: [...value.entries, { kind: "turn", turn: next }] }}>{content}</QuestionConversationProvider>);
  expect(screen.queryByTestId("question-dock")).toBeNull();
  expect(screen.queryByText(/Вопрос в истории/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Ответить" })).toBeNull();
  expect(value.sendAnswer).not.toHaveBeenCalled();
});

it("keeps a pending submission bound to its original RPC when the dock switches questions", async () => {
  const first = { connectionId: "server", requestId: "first", requestKey: "scope-first", state: "pending" as const, createdAt: 1,
    method: "item/tool/requestUserInput", params: { turnId: "first-turn", questions: [{ id: "q", question: "Первый вопрос", options: [{ label: "Первый ответ", description: "" }] }] } };
  const second = { ...first, requestId: "second", requestKey: "scope-second", params: { ...first.params, questions: [{ id: "q", question: "Второй вопрос", options: [{ label: "Второй ответ", description: "" }] }] } };
  const respond = jest.fn(async () => undefined);
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "scope-thread", activeTurnId: "first-turn", entries: [], pendingRequest: first, onRespond: respond, sendAnswer: undefined };
  const screen = render(<QuestionConversationProvider value={value}><QuestionDock /></QuestionConversationProvider>);
  await screen.findByText("Первый вопрос");
  const persistence = Promise.withResolvers<void>();
  jest.mocked(writeQuestionDraft).mockImplementationOnce(() => persistence.promise);
  fireEvent.press(screen.getByRole("button", { name: "Ответить" }));
  screen.rerender(<QuestionConversationProvider value={{ ...value, pendingRequest: second }}><QuestionDock /></QuestionConversationProvider>);
  await screen.findByText("Второй вопрос");
  await act(async () => { persistence.resolve(); });
  await waitFor(() => expect(respond).toHaveBeenCalledWith(first, { answers: { q: { answers: ["Первый ответ"] } } }));
});

it.each(["completed", "final-message"])("skips an unanswered dock at %s without sending a default answer", async (ending) => {
  const turn = { id: "finish-turn", status: "inProgress" as const, itemsView: "full" as const, error: null, startedAt: null, completedAt: null, durationMs: null,
    items: [{ type: "agentMessage" as const, id: "finish-q", text: "Question", phase: null, delivery: "async" as const, memoryCitation: null, questions: [{ title: "Still needed?", options: ["Yes", "No"] }] }] };
  const sendAnswer = jest.fn(async () => undefined);
  const value = { latestHistoryPresent: true, connectionId: "server", threadId: "finish-thread", activeTurnId: turn.id, entries: [{ kind: "turn" as const, turn }], pendingRequest: null, onRespond: undefined, sendAnswer };
  const view = render(<QuestionConversationProvider value={value}><QuestionDock /></QuestionConversationProvider>);
  await view.findByText("Still needed?");
  const completed = ending === "completed" ? { ...turn, status: "completed" as const } : {
    ...turn, items: [...turn.items, { type: "agentMessage" as const, id: "final", text: "Done", phase: "final_answer" as const, delivery: null, memoryCitation: null, questions: null }],
  };
  view.rerender(<QuestionConversationProvider value={{ ...value, entries: [{ kind: "turn", turn: completed }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(view.queryByTestId("question-dock")).toBeNull();
  expect(sendAnswer).not.toHaveBeenCalled();
  view.unmount();
  const restored = render(<QuestionConversationProvider value={{ ...value, activeTurnId: null, entries: [{ kind: "turn", turn: completed }] }}><QuestionDock /></QuestionConversationProvider>);
  expect(restored.queryByTestId("question-dock")).toBeNull();
});

it.each(["Пропустить вопрос", "Пропустить"])("%s closes the card without submitting the selected option", async (label) => {
  const onSkip = jest.fn(async () => undefined);
  const send = jest.fn(async () => undefined);
  const source = interaction();
  const view = render(<QuestionCard interaction={source} onSkip={onSkip} canSend delivered={false} failed={false} send={send} statusText="Можно ответить" />);
  await view.findByText("Как продолжить?");
  fireEvent.press(view.getByRole("button", { name: label, exact: true }));
  await waitFor(() => expect(view.queryByTestId("question-card")).toBeNull());
  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

it("keeps the draft and retry controls when skipping fails", async () => {
  const onSkip = jest.fn(async () => { throw new Error("storage unavailable"); });
  const view = render(<QuestionCard interaction={interaction()} onSkip={onSkip} canSend delivered={false} failed={false} send={async () => undefined} statusText="Можно ответить" />);
  await view.findByText("Как продолжить?");
  fireEvent.changeText(view.getByPlaceholderText("Свой ответ"), "Мой черновик");
  fireEvent.press(view.getByRole("button", { name: "Пропустить", exact: true }));
  await view.findByText("Не удалось пропустить вопрос. Попробуй ещё раз.");
  expect(view.getByDisplayValue("Мой черновик")).toBeOnTheScreen();
});

it("skips a blocking RPC using an empty answer map", async () => {
  const request = { connectionId: "server", createdAt: 1, requestId: "skip-rpc", requestKey: "skip-rpc", state: "pending" as const, method: "item/tool/requestUserInput", params: { questions: [{ id: "q", question: "Need input?", options: [{ label: "Default", description: "" }] }] } };
  const onRespond = jest.fn(async () => undefined);
  const view = render(<RpcQuestionCard request={request} onRespond={onRespond} />);
  await view.findByText("Need input?");
  fireEvent.press(view.getByRole("button", { name: "Пропустить", exact: true }));
  await waitFor(() => expect(onRespond).toHaveBeenCalledWith(request, { answers: {} }));
  await waitFor(() => expect(view.queryByTestId("question-card")).toBeNull());
});

it("cannot submit a selected answer while dismissal is pending or already complete", async () => {
  const session = await loadQuestionSession(interaction());
  session.setDraft(1, { selected: null, custom: "Ready" });
  const dismissal = Promise.withResolvers<void>();
  const pending = session.skip(() => dismissal.promise);
  const send = jest.fn(async () => undefined);
  await session.submit(send);
  expect(send).not.toHaveBeenCalled();
  dismissal.resolve();
  await pending;
  await session.submit(send);
  expect(send).not.toHaveBeenCalled();
});
