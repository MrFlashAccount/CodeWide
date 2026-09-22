import { act, renderHook } from "@testing-library/react-native";

import { useComposerDeliveryActions } from "../src/features/composer/submission";

function delivery(composerScope: string, send: () => Promise<void>) {
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
    voicePhase: "idle" as const,
    voiceRetryAvailable: false,
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
