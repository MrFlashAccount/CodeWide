import { act, renderHook } from "@testing-library/react-native";
import type { StoredComposerPreferences } from "../src/data/thread-ui-state-types";
import { useComposerDraftCommands } from "../src/features/composer/draft";
import { useComposerSettings } from "../src/features/composer/settings";
import { useComposerSubmission } from "../src/features/composer/submission";

function createActivation(threadId: string) {
  const preferences: StoredComposerPreferences = {
    model: null,
    effort: null,
    personality: null,
    permissions: null,
    skillPaths: [],
    sendMode: "start",
  };
  const draft: Parameters<typeof useComposerDraftCommands>[0] = {
    queuedComposerEdit: null,
    setQueuedComposerEdit: () => undefined,
    latestDraftRef: { current: { latest: threadId } },
    latestAttachmentsRef: { current: { latest: [] } },
    composerMarkdownRef: { current: threadId },
    draftConnectionId: "server",
    draftThreadId: threadId,
    saveDraft: jest.fn(async () => undefined),
    saveDraftAttachments: jest.fn(async () => undefined),
  };
  const owner = { current: true, replacement: false };
  const settings: Parameters<typeof useComposerSettings>[0] = {
    composerScope: threadId,
    newChat: true,
    cwd: "/workspace",
    draftConnectionId: "server",
    draftThreadId: threadId,
    workspaceResources: null,
    controlsResourceId: null,
    composerPreferences: preferences,
    latestComposerPreferencesRef: {
      current: { scope: threadId, rendered: preferences, latest: preferences },
    },
    conversationOwner: { isCurrent: () => owner.current, hasReplacement: () => owner.replacement },
    onLoadControls: undefined,
    onUpdateSettings: undefined,
    saveComposerPreferences: jest.fn(async () => undefined),
  };
  const onSend = jest.fn((_text: string, _mode: unknown, _options: unknown) =>
    Promise.resolve("command"),
  );
  return { threadId, draft, settings, owner, onSend };
}
function useActivation(activation: ReturnType<typeof createActivation>) {
  const commands = useComposerDraftCommands(activation.draft);
  const settings = useComposerSettings(activation.settings);
  return useComposerSubmission({
    composerScope: activation.threadId,
    composerUploadScope: activation.threadId,
    latestAttachmentsRef: activation.draft.latestAttachmentsRef,
    latestDraftRef: activation.draft.latestDraftRef,
    latestComposerPreferencesRef: activation.settings.latestComposerPreferencesRef,
    composerMarkdownRef: activation.draft.composerMarkdownRef,
    selectedModel: settings.selectedModel,
    selectedEffort: settings.selectedEffort,
    selectedPersonality: settings.selectedPersonality,
    selectedPermissions: settings.selectedPermissions,
    capturePreferenceUpdate: settings.capturePreferenceUpdate,
    captureControlsResource: settings.captureControlsResource,
    queuedComposerEdit: null,
    pastedAttachmentPendingRef: { current: false },
    captureDraftMutations: commands.captureDraftMutations,
    threadLifecycleActive: false,
    currentTurnId: null,
    contentReviewAttachmentId: null,
    clearContentReviewAttachmentId: () => undefined,
    conversationOwner: activation.settings.conversationOwner,
    draftConnectionId: "server",
    draftThreadId: activation.threadId,
    onSend: activation.onSend,
    onListQueue: undefined,
    saveDraft: activation.draft.saveDraft,
    saveDraftAttachments: activation.draft.saveDraftAttachments,
  });
}
function pendingSubmission() {
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<string>((_resolve, onReject) => {
    reject = onReject;
  });
  return { promise, reject };
}

it("delivers a late final transcript using its captured chat and leaves the current composer intact", async () => {
  const first = createActivation("first");
  const second = createActivation("second");
  const hook = renderHook(useActivation, { initialProps: first });
  const finishVoice = hook.result.current.captureSend();
  hook.rerender(second);
  await act(async () => {
    finishVoice("Final transcript");
  });
  expect(first.onSend).toHaveBeenCalledWith("Final transcript", { type: "start" }, {});
  expect(second.onSend).not.toHaveBeenCalled();
  expect(first.draft.latestDraftRef.current.latest).toBe("");
  expect(second.draft.latestDraftRef.current.latest).toBe("second");
});

it("merges a rejected submission with newer typing in the same composer", async () => {
  const activation = createActivation("sent text");
  const pending = pendingSubmission();
  activation.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: activation });
  act(() => hook.result.current.send());
  activation.draft.latestDraftRef.current.latest = "New typing";
  activation.draft.composerMarkdownRef.current = "New typing";
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(activation.draft.latestDraftRef.current.latest).toBe("sent text\n\nNew typing");
});

it("restores rejected text to the departed chat without touching the newly selected chat", async () => {
  const first = createActivation("first");
  const second = createActivation("second");
  const pending = pendingSubmission();
  first.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: first });
  act(() => hook.result.current.send());
  first.owner.current = false;
  hook.rerender(second);
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(first.draft.saveDraft).toHaveBeenLastCalledWith("server", "first", "first");
  expect(second.draft.saveDraft).not.toHaveBeenCalled();
  expect(second.draft.latestDraftRef.current.latest).toBe("second");
});

it("does not let a stale same-scope owner overwrite its replacement after rejection", async () => {
  const first = createActivation("first");
  const pending = pendingSubmission();
  first.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: first });
  act(() => hook.result.current.send());
  first.owner.current = false;
  first.owner.replacement = true;
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(first.draft.latestDraftRef.current.latest).toBe("");
  expect(first.draft.saveDraft).toHaveBeenCalledTimes(1);
});
