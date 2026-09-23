import { act, renderHook } from "@testing-library/react-native";

import { useComposerDeliveryActions } from "../src/features/composer/submission";
import type { ComposerDeliveryCapabilities } from "../src/features/composer/deliveryCapabilities";

function delivery(
  composerScope: string,
  send: () => Promise<void>,
  overrides: Partial<ComposerDeliveryCapabilities> = {},
): ComposerDeliveryCapabilities {
  return {
    attachments: [],
    cancelQueuedComposerEdit: jest.fn(),
    clearComposerText: jest.fn(),
    composerScope,
    currentTurnId: null,
    discardVoice: jest.fn(async () => undefined),
    draft: "The same message https://example.test/thread",
    finishVoice: jest.fn(async () => undefined),
    goalSubmissionActive: false,
    onEditQueued: undefined,
    onInterrupt: undefined,
    pastedAttachmentPending: false,
    queuedComposerEdit: null,
    queuedComposerEditBusy: false,
    saveQueuedComposerEdit: jest.fn(),
    send,
    threadLifecycleActive: false,
    uploadsBlockSend: false,
    voiceError: null,
    voicePhase: "idle",
    voiceRetryAvailable: false,
    ...overrides,
  };
}

it("allows identical text in another chat while the old action remains pending", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const sendFirst = jest.fn(() => first.promise);
  const sendSecond = jest.fn(() => second.promise);
  const hook = renderHook(useComposerDeliveryActions, {
    initialProps: delivery("server:first", sendFirst),
  });
  act(() => hook.result.current.activatePrimaryAction());
  expect(hook.result.current.sendDisabled).toBe(true);
  hook.rerender(delivery("server:second", sendSecond));
  expect(hook.result.current.sendDisabled).toBe(false);

  act(() => hook.result.current.activatePrimaryAction());
  expect(sendSecond).toHaveBeenCalledTimes(1);
  expect(hook.result.current.sendDisabled).toBe(true);
  await act(async () => first.resolve());
  expect(hook.result.current.sendDisabled).toBe(true);
  await act(async () => second.resolve());
  expect(hook.result.current.sendDisabled).toBe(false);
  expect(sendFirst).toHaveBeenCalledTimes(1);
});

it("does not interrupt the same turn again after the first request succeeds", async () => {
  const interrupt = jest.fn(async () => undefined);
  const send = jest.fn(async () => undefined);
  const firstTurn = delivery("server:first", send, {
    currentTurnId: "turn:first",
    draft: "",
    onInterrupt: interrupt,
    threadLifecycleActive: true,
  });
  const hook = renderHook(useComposerDeliveryActions, { initialProps: firstTurn });

  act(() => hook.result.current.activatePrimaryAction());
  await act(async () => Promise.resolve());
  expect(interrupt).toHaveBeenCalledTimes(1);
  expect(interrupt).toHaveBeenLastCalledWith("turn:first");
  expect(hook.result.current.sendDisabled).toBe(true);

  act(() => hook.result.current.activatePrimaryAction());
  expect(interrupt).toHaveBeenCalledTimes(1);

  hook.rerender({ ...firstTurn, currentTurnId: "turn:second" });
  expect(hook.result.current.sendDisabled).toBe(false);
  act(() => hook.result.current.activatePrimaryAction());
  await act(async () => Promise.resolve());
  expect(interrupt).toHaveBeenCalledTimes(2);
  expect(interrupt).toHaveBeenLastCalledWith("turn:second");
});

it("can discard pending voice finalization and send again without waiting for remote cleanup", async () => {
  const finishing = Promise.withResolvers<void>();
  const cancelling = Promise.withResolvers<void>();
  const sending = Promise.withResolvers<void>();
  const finishVoice = jest.fn(() => finishing.promise);
  const discardVoice = jest.fn(() => cancelling.promise);
  const send = jest.fn(() => sending.promise);
  const props = delivery("server:voice", send, {
    voicePhase: "recording",
    finishVoice,
    discardVoice,
  });
  const hook = renderHook(useComposerDeliveryActions, { initialProps: props });
  act(() => hook.result.current.activatePrimaryAction());
  expect(finishVoice).toHaveBeenCalledWith(true);
  hook.rerender({ ...props, voicePhase: "finishing" });
  expect(hook.result.current.sendDisabled).toBe(true);
  act(() => hook.result.current.discardComposer());
  expect(discardVoice).toHaveBeenCalledTimes(1);
  // The recording owner publishes idle immediately; server cancellation may still be offline.
  hook.rerender({ ...props, voicePhase: "idle" });
  expect(hook.result.current.sendDisabled).toBe(false);
  act(() => hook.result.current.activatePrimaryAction());
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishing.resolve();
    cancelling.resolve();
  });
  expect(hook.result.current.sendDisabled).toBe(true);
  await act(async () => sending.resolve());
  expect(hook.result.current.sendDisabled).toBe(false);
});
