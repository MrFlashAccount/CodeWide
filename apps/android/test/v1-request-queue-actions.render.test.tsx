import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { ApprovalPrompt } from "../src/features/requests/RequestFeature";
import { useInlineQueueOverlay } from "../src/features/queue/inlineQueueState";
import { useQueueCommands } from "../src/features/queue/queueCommands";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import type { InlineQueueOverlayProps } from "../src/features/queue/inlineQueueContract";

function pending() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it("keeps a request pending until response settles and exposes rejection for retry", async () => {
  const response = pending();
  const request: PendingServerRequest = {
    connectionId: "server", requestKey: "request", requestId: 1,
    method: "item/commandExecution/requestApproval", params: { command: "build" },
    state: "pending", createdAt: 0,
  };
  const respond = jest.fn(() => response.promise);
  const screen = render(<ApprovalPrompt request={request} requestCount={1} onRespond={respond} />);
  fireEvent.press(screen.getByText("Accept once"));
  expect(respond).toHaveBeenCalledWith(request, { decision: "accept" });
  expect(screen.getByText("RESOLVING…")).toBeOnTheScreen();
  await act(async () => response.reject(new Error("Connection lost")));
  await waitFor(() => expect(screen.getByText("Connection lost")).toBeOnTheScreen());
  expect(screen.queryByText("RESOLVING…")).toBeNull();
});

it("keeps queued action busy through refresh, exposes failure and preserves the command id", async () => {
  const response = pending();
  const refresh = pending();
  const close = jest.fn();
  const options: InlineQueueOverlayProps = {
    maxHeight: 400, expanded: true, activeTurnId: "turn", onOpen: jest.fn(), onClose: close,
    items: [{ id: "command", text: "prompt", attachmentCount: 0, createdAt: 0, state: "queued", lastError: null }],
    onRefresh: () => refresh.promise,
  };
  const hook = renderHook(() => useInlineQueueOverlay(options));
  const intent = hook.result.current.run;
  let operation = Promise.resolve(false);
  act(() => { operation = hook.result.current.run("command", () => response.promise, true); });
  expect(hook.result.current.busyId).toBe("command");
  expect(hook.result.current.run).toBe(intent);
  await act(async () => response.resolve());
  expect(close).not.toHaveBeenCalled();
  expect(hook.result.current.busyId).toBe("command");
  await act(async () => { refresh.resolve(); await operation; });
  expect(close).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busyId).toBeNull();
  await act(async () => { await hook.result.current.run("command", async () => { throw new Error("Rejected"); }, false); });
  expect(hook.result.current.actionError).toBe("Rejected");
  expect(hook.result.current.busyId).toBeNull();
});

it("routes queue reordering and steering through the selected lower command authority", async () => {
  const commands = {
    listQueuedPrompts: jest.fn(async () => []), editQueuedPrompt: jest.fn(async () => undefined),
    cancelQueuedPrompt: jest.fn(async () => undefined), moveQueuedPrompt: jest.fn(async () => undefined),
    steerQueuedPrompt: jest.fn(async () => undefined),
  };
  const hook = renderHook(({ threadId }) => useQueueCommands(commands, "server", threadId), { initialProps: { threadId: "first" } });
  const move = hook.result.current.onMoveQueued;
  await act(async () => hook.result.current.onMoveQueued("command", -1));
  expect(commands.moveQueuedPrompt).toHaveBeenCalledWith("server", "first", "command", -1);
  hook.rerender({ threadId: "second" });
  expect(hook.result.current.onMoveQueued).toBe(move);
  await act(async () => move("command", 1));
  expect(commands.moveQueuedPrompt).toHaveBeenLastCalledWith("server", "second", "command", 1);
  await act(async () => hook.result.current.onSteerQueued("command", "live-turn"));
  expect(commands.steerQueuedPrompt).toHaveBeenCalledWith("server", "command", "live-turn");
});
