import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadCurrentOutcome } from "../src/data/thread-current-outcome";
import { selectComposerContinuation, useComposerContinuation } from "../src/features/composer/composerContinuation";
import { ComposerSubmitAction } from "../src/features/composer/ComposerSubmitAction";
import type { ComposerDeliveryCapabilities } from "../src/features/composer/deliveryCapabilities";
import { useComposerDeliveryActions } from "../src/features/composer/submission";
import { useConversationOwner } from "../src/ui/use-conversation-owner";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const goal = (status: ThreadGoal["status"]): ThreadGoal => ({
  threadId: "thread", objective: "Finish the task", status, tokenBudget: 1000,
  tokensUsed: 42, timeUsedSeconds: 8, createdAt: 1, updatedAt: 2,
});
const outcome = (status: "interrupted" | "completed" | "inProgress", turnId = "stopped"): ThreadCurrentOutcome => ({ status, turnId, startedAt: 1 });
function selection(overrides: Partial<Parameters<typeof selectComposerContinuation>[0]> = {}) {
  return {
    acceptsInput: true, captureGoalLifecycle: undefined, currentGoal: null,
    currentOutcome: outcome("interrupted"), onContinueTurn: jest.fn(async () => undefined),
    threadLifecycleActive: false, ...overrides,
  };
}
function delivery(overrides: Partial<ComposerDeliveryCapabilities> = {}): ComposerDeliveryCapabilities {
  return {
    attachments: [], cancelQueuedComposerEdit: jest.fn(), clearComposerText: jest.fn(),
    composerScope: "server:thread", continuation: null, currentTurnId: null,
    discardVoice: jest.fn(async () => undefined), draft: "", finishVoice: jest.fn(async () => undefined),
    goalSubmissionActive: false, onEditQueued: undefined, onInterrupt: jest.fn(async () => undefined),
    pastedAttachmentPending: false, pauseGoalBeforeInterrupt: undefined, queuedComposerEdit: null,
    queuedComposerEditBusy: false, saveQueuedComposerEdit: jest.fn(), send: jest.fn(async () => undefined),
    threadLifecycleActive: false, uploadsBlockSend: false, voiceError: null, voicePhase: "idle",
    voiceRetryAvailable: false, ...overrides,
  };
}

beforeEach(resetAppDialog);

it.each(["interrupted", "failed"] as const)("offers Play for an authoritative %s turn", async status => {
  const onContinueTurn = jest.fn(async () => undefined);
  const currentOutcome: ThreadCurrentOutcome = status === "failed"
    ? { status, message: "Network failed", turnId: "stopped", startedAt: 1 }
    : outcome(status);
  const target = selectComposerContinuation(selection({ currentOutcome, onContinueTurn }));
  expect(target?.label).toBe("Continue response");
  await target?.resume();
  expect(onContinueTurn).toHaveBeenCalledWith("stopped");
});

it.each([outcome("completed"), outcome("inProgress"), null])("does not offer ordinary continuation for %#", currentOutcome => {
  expect(selectComposerContinuation(selection({ currentOutcome }))).toBeNull();
});

it.each(["paused", "blocked", "active"] as const)("resumes a %s goal without sending a second turn", async status => {
  const currentGoal = goal(status);
  const setStatus = jest.fn(async () => ({ ...currentGoal, status: "active" as const }));
  const onContinueTurn = jest.fn(async () => undefined);
  const captureGoalLifecycle = jest.fn(() => ({ setStatus, clear: jest.fn(async () => true) }));
  const target = selectComposerContinuation(selection({ currentGoal, captureGoalLifecycle, onContinueTurn }));
  expect(target?.label).toBe("Resume goal");
  await target?.resume();
  expect(setStatus).toHaveBeenCalledTimes(1);
  expect(setStatus).toHaveBeenCalledWith("active");
  expect(onContinueTurn).not.toHaveBeenCalled();
});

it.each(["complete", "budgetLimited", "usageLimited"] as const)("does not reactivate a %s goal", status => {
  expect(selectComposerContinuation(selection({ currentGoal: goal(status), captureGoalLifecycle: () => ({ clear: async () => true, setStatus: async () => goal("active") }) }))).toBeNull();
});

it("keeps running work, unknown permissions and unavailable capabilities ineligible", () => {
  expect(selectComposerContinuation(selection({ threadLifecycleActive: true }))).toBeNull();
  expect(selectComposerContinuation(selection({ acceptsInput: false }))).toBeNull();
  expect(selectComposerContinuation(selection({ onContinueTurn: undefined }))).toBeNull();
});

function useAction(props: { scope: string; resume: () => Promise<void>; turnId: string }) {
  const owner = useConversationOwner(props.scope);
  const continuation = useComposerContinuation(props.scope, owner, {
    key: props.turnId, label: "Continue response", resume: props.resume,
  });
  return useComposerDeliveryActions(delivery({ composerScope: props.scope, continuation: {
    activate: continuation.activate, disabled: continuation.disabled, label: "Continue response",
  } }));
}

it("admits one Play per outcome, waits for sync after acknowledgement and allows a later failed turn", async () => {
  const ack = Promise.withResolvers<void>();
  const resume = jest.fn(() => ack.promise);
  const props = { scope: "server:thread", resume, turnId: "stopped" };
  const hook = renderHook(useAction, { initialProps: props });
  expect(hook.result.current.resumeAction).toBe("Continue response");
  act(() => { hook.result.current.activatePrimaryAction(); hook.result.current.activatePrimaryAction(); });
  expect(resume).toHaveBeenCalledTimes(1);
  expect(hook.result.current.sendDisabled).toBe(true);
  await act(async () => ack.resolve());
  act(() => hook.result.current.activatePrimaryAction());
  expect(resume).toHaveBeenCalledTimes(1);
  hook.rerender({ ...props, turnId: "later-failed" });
  expect(hook.result.current.sendDisabled).toBe(false);
  await act(async () => hook.result.current.activatePrimaryAction());
  expect(resume).toHaveBeenCalledTimes(2);
});

it("keeps late failure in its original activation and does not unlock or alert another chat", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const hook = renderHook(useAction, { initialProps: { scope: "first", turnId: "stopped", resume: () => first.promise } });
  act(() => hook.result.current.activatePrimaryAction());
  hook.rerender({ scope: "second", turnId: "other", resume: () => second.promise });
  act(() => hook.result.current.activatePrimaryAction());
  await act(async () => first.reject(new Error("Old connection failed")));
  expect(hook.result.current.sendDisabled).toBe(true);
  expect(getAppDialogRequest()).toBeNull();
  await act(async () => second.resolve());
});

it("surfaces the actual current failure and permits an explicit retry", async () => {
  const resume = jest.fn().mockRejectedValueOnce(new Error("Rejected input")).mockResolvedValueOnce(undefined);
  const hook = renderHook(useAction, { initialProps: { scope: "thread", turnId: "stopped", resume } });
  await act(async () => hook.result.current.activatePrimaryAction());
  expect(getAppDialogRequest()?.message).toBe("Rejected input");
  expect(hook.result.current.sendDisabled).toBe(false);
  await act(async () => hook.result.current.activatePrimaryAction());
  expect(resume).toHaveBeenCalledTimes(2);
});

it("uses Stop while running and does not resume on completion of Stop", async () => {
  const activate = jest.fn();
  const onInterrupt = jest.fn(async () => undefined);
  const continuation = { activate, disabled: false, label: "Continue response" as const };
  const props = delivery({ continuation, currentTurnId: "running", threadLifecycleActive: true, onInterrupt });
  const hook = renderHook(useComposerDeliveryActions, { initialProps: props });
  expect(hook.result.current.stopAction).toBe("response");
  expect(hook.result.current.resumeAction).toBeNull();
  await act(async () => hook.result.current.activatePrimaryAction());
  hook.rerender({ ...props, currentTurnId: null, threadLifecycleActive: false });
  expect(hook.result.current.resumeAction).toBe("Continue response");
  expect(activate).not.toHaveBeenCalled();
  act(() => hook.result.current.activatePrimaryAction());
  expect(activate).toHaveBeenCalledTimes(1);
});

it.each([{ draft: "my draft" }, { attachments: [{ id: "file", rootId: "files", path: "doc.txt", name: "doc.txt", kind: "file" as const }] }])(
  "keeps Send for draft content %#", async content => {
    const activate = jest.fn();
    const send = jest.fn(async () => undefined);
    const hook = renderHook(useComposerDeliveryActions, { initialProps: delivery({ ...content, send,
      continuation: { activate, disabled: true, label: "Continue response" },
    }) });
    expect(hook.result.current.resumeAction).toBeNull();
    expect(hook.result.current.sendDisabled).toBe(false);
    await act(async () => hook.result.current.activatePrimaryAction());
    expect(send).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  },
);

it("renders an accessible Play action and dispatches the same one-tap intent", () => {
  const activatePrimaryAction = jest.fn();
  const view = render(<ComposerSubmitAction
    activatePrimaryAction={activatePrimaryAction} composerDiscardEnabled={false} currentTurnId={null}
    deliveryActions={[]} discardComposer={jest.fn()} dismissComposerKeyboardForOverlay={jest.fn()}
    editingQueuedMessage={false} goalAttachmentVisible={false} handleDeliveryAction={jest.fn()}
    queuedComposerEditBusy={false} resumeAction="Continue response" sendDisabled={false}
    steerComposer={jest.fn()} stopAction={null} threadLifecycleActive={false} voicePhase="idle"
  />);
  fireEvent.press(view.getByLabelText("Continue response"));
  expect(activatePrimaryAction).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText("Send message")).toBeNull();
});

it("retains Play admission when the same conversation remounts", async () => {
  const resume = jest.fn(async () => undefined);
  const props = { scope: "remount-contract", resume, turnId: "stopped" };
  const first = renderHook(useAction, { initialProps: props });
  await act(async () => first.result.current.activatePrimaryAction());
  first.unmount();
  const second = renderHook(useAction, { initialProps: props });
  expect(second.result.current.sendDisabled).toBe(true);
  act(() => second.result.current.activatePrimaryAction());
  expect(resume).toHaveBeenCalledTimes(1);
});

it("keeps the same admission key when a resumed goal publishes active before its turn", () => {
  const captureGoalLifecycle = () => ({ clear: async () => true, setStatus: async () => goal("active") });
  const paused = selectComposerContinuation(selection({ currentGoal: goal("paused"), captureGoalLifecycle }));
  const active = selectComposerContinuation(selection({ currentGoal: goal("active"), captureGoalLifecycle }));
  expect(paused?.key).toBe(active?.key);
});

it("waits for Stop settlement before admitting Play even if the turn projection goes idle early", async () => {
  const stopped = Promise.withResolvers<void>();
  const activate = jest.fn();
  const props = delivery({ continuation: { activate, disabled: false, label: "Continue response" },
    currentTurnId: "running", threadLifecycleActive: true, onInterrupt: () => stopped.promise,
  });
  const hook = renderHook(useComposerDeliveryActions, { initialProps: props });
  act(() => hook.result.current.activatePrimaryAction());
  hook.rerender({ ...props, currentTurnId: null, threadLifecycleActive: false });
  expect(hook.result.current.sendDisabled).toBe(true);
  act(() => hook.result.current.activatePrimaryAction());
  expect(activate).not.toHaveBeenCalled();
  await act(async () => stopped.resolve());
  act(() => hook.result.current.activatePrimaryAction());
  expect(activate).toHaveBeenCalledTimes(1);
});


it("does not retry a goal whose activation acknowledgement was lost", async () => {
  const setStatus = jest.fn(async () => { throw new Error("RPC timed out"); });
  const target = selectComposerContinuation(selection({ currentGoal: goal("paused"),
    captureGoalLifecycle: () => ({ clear: async () => true, setStatus }),
  }));
  const hook = renderHook(() => useComposerContinuation("uncertain-goal-contract", useConversationOwner("uncertain-goal-contract"), target));
  await act(async () => hook.result.current.activate());
  expect(hook.result.current.disabled).toBe(true);
  expect(getAppDialogRequest()?.message).toContain("RPC timed out");
  expect(getAppDialogRequest()?.message).toContain("could not be confirmed");
  act(() => hook.result.current.activate());
  expect(setStatus).toHaveBeenCalledTimes(1);
});

it("permits a goal retry after explicit validation rejection", async () => {
  const setStatus = jest.fn().mockRejectedValueOnce(new RpcResponseError(-32602, "Goal rejected")).mockResolvedValueOnce(goal("active"));
  const target = selectComposerContinuation(selection({ currentGoal: goal("paused"),
    captureGoalLifecycle: () => ({ clear: async () => true, setStatus }),
  }));
  const hook = renderHook(() => useComposerContinuation("rejected-goal-contract", useConversationOwner("rejected-goal-contract"), target));
  await act(async () => hook.result.current.activate());
  expect(hook.result.current.disabled).toBe(false);
  expect(getAppDialogRequest()?.message).toBe("Goal rejected");
  await act(async () => hook.result.current.activate());
  expect(setStatus).toHaveBeenCalledTimes(2);
});
