import { act, renderHook } from "@testing-library/react-native";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../src/data/thread-ui-state-types";
import { useComposerDraftCommands } from "../src/features/composer/draft";
import type { ComposerMarkdownInputHandle } from "../src/features/composer/input/ComposerMarkdownInput.types";
import { useComposerSettings } from "../src/features/composer/settings";
import { useComposerSubmission } from "../src/features/composer/submission";
import { composerSessionFixture } from "./composer-session-fixture";

function createActivation(
  threadId: string,
  goalSubmission: Parameters<typeof useComposerSubmission>[0]["goalSubmission"] = null,
) {
  const preferences: StoredComposerPreferences = {
    model: null,
    effort: null,
    personality: null,
    permissions: null,
    skillPaths: [],
    sendMode: "start",
  };
  const composerSession = composerSessionFixture(threadId, preferences);
  const draft: Parameters<typeof useComposerDraftCommands>[0] = {
    composerSession,
    queuedComposerEdit: null,
    draftConnectionId: "server",
    draftThreadId: threadId,
    saveDraft: jest.fn(async () => undefined),
    saveDraftAttachments: jest.fn(async () => undefined),
  };
  const owner = { current: true, replacement: false };
  const settings: Parameters<typeof useComposerSettings>[0] = {
    composerScope: threadId,
    composerSession,
    newChat: true,
    cwd: "/workspace",
    draftConnectionId: "server",
    draftThreadId: threadId,
    workspaceResources: null,
    controlsResourceId: null,
    composerPreferences: preferences,
    conversationOwner: { isCurrent: () => owner.current, hasReplacement: () => owner.replacement },
    onLoadControls: undefined,
    onUpdateSettings: undefined,
    saveComposerPreferences: jest.fn(async () => undefined),
  };
  const onSend = jest.fn((_text: string, _mode: unknown, _options: unknown) =>
    Promise.resolve("command"),
  );
  const composerInput: ComposerMarkdownInputHandle = {
    focus: jest.fn(),
    getValue: jest.fn(async () => ({ markdown: threadId, plainText: threadId })),
    insertCode: jest.fn(),
    insertLinkedText: jest.fn(),
    insertText: jest.fn(),
    startMention: jest.fn(),
    toggleOrderedList: jest.fn(),
    toggleUnorderedList: jest.fn(),
  };
  return {
    threadId,
    draft,
    settings,
    owner,
    onSend,
    goalSubmission,
    composerInput,
    composerSession,
  };
}
function useActivation(activation: ReturnType<typeof createActivation>) {
  const commands = useComposerDraftCommands(activation.draft);
  const settings = useComposerSettings(activation.settings);
  return useComposerSubmission({
    composerScope: activation.threadId,
    composerUploadScope: activation.threadId,
    composerInputRef: { current: activation.composerInput },
    composerSession: activation.composerSession,
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
    goalSubmission: activation.goalSubmission,
    onSend: activation.onSend,
    onListQueue: undefined,
    saveDraft: activation.draft.saveDraft,
    saveDraftAttachments: activation.draft.saveDraftAttachments,
  });
}

it("keeps visible plain text when the markdown event lags behind an attachment send", async () => {
  const activation = createActivation("caption");
  activation.composerSession.updateText({ markdown: "", plainText: "caption" });
  activation.composerSession.updateAttachments([
    {
      id: "attachment",
      rootId: "attachments",
      path: "thread/photo.png",
      name: "photo.png",
      kind: "image",
    },
  ]);
  const hook = renderHook(useActivation, { initialProps: activation });

  await act(async () => {
    await hook.result.current.send();
  });

  expect(activation.onSend).toHaveBeenCalledWith(
    "caption",
    { type: "start" },
    { attachments: [expect.objectContaining({ name: "photo.png" })] },
  );
  expect(activation.composerInput.getValue).not.toHaveBeenCalled();
});

it("reads the native editor before allowing an attachment-only fallback", async () => {
  const activation = createActivation("");
  activation.composerInput.getValue = jest.fn(async () => ({
    markdown: "native caption",
    plainText: "native caption",
  }));
  activation.composerSession.updateAttachments([
    {
      id: "attachment",
      rootId: "attachments",
      path: "thread/photo.png",
      name: "photo.png",
      kind: "image",
    },
  ]);
  const hook = renderHook(useActivation, { initialProps: activation });

  await act(async () => {
    await hook.result.current.send();
  });

  expect(activation.onSend).toHaveBeenCalledWith(
    "native caption",
    { type: "start" },
    { attachments: [expect.objectContaining({ name: "photo.png" })] },
  );
  expect(activation.composerSession.read().plainText).toBe("");
});

it("finishes a pending native read against the chat that started Send", async () => {
  const first = createActivation("");
  const second = createActivation("second");
  const pending = Promise.withResolvers<{ markdown: string; plainText: string }>();
  first.composerInput.getValue = jest.fn(() => pending.promise);
  first.composerSession.updateAttachments([
    {
      id: "attachment",
      rootId: "attachments",
      path: "thread/photo.png",
      name: "photo.png",
      kind: "image",
    },
  ]);
  const hook = renderHook(useActivation, { initialProps: first });
  let send: Promise<void> = Promise.resolve();
  act(() => {
    send = hook.result.current.send();
  });
  hook.rerender(second);

  await act(async () => {
    pending.resolve({ markdown: "first caption", plainText: "first caption" });
    await send;
  });

  expect(first.onSend).toHaveBeenCalledWith(
    "first caption",
    { type: "start" },
    { attachments: [expect.objectContaining({ name: "photo.png" })] },
  );
  expect(second.onSend).not.toHaveBeenCalled();
  expect(second.composerSession.read().plainText).toBe("second");
});

it("submits the main composer text as a goal and closes only its goal attachment", async () => {
  const close = jest.fn();
  const submit = jest.fn(async (_objective: string) => undefined);
  const activation = createActivation("Ship the goal composer", { close, submit });
  const attachment: StoredDraftAttachment = {
    id: "attachment",
    rootId: "attachments",
    path: "goal/reference.md",
    name: "reference.md",
    kind: "file",
  };
  activation.composerSession.updateAttachments([attachment]);
  const hook = renderHook(useActivation, { initialProps: activation });

  await act(async () => {
    await hook.result.current.send();
  });

  expect(submit).toHaveBeenCalledWith("Ship the goal composer");
  expect(activation.onSend).not.toHaveBeenCalled();
  expect(activation.composerSession.read().plainText).toBe("");
  expect(activation.composerSession.read().attachments).toEqual([attachment]);
  expect(close).toHaveBeenCalledTimes(1);
});

it("restores the goal text and keeps its attachment open when goal submission fails", async () => {
  let reject: (error: Error) => void = () => undefined;
  const operation = new Promise<void>((_resolve, onReject) => {
    reject = onReject;
  });
  const close = jest.fn();
  const submit = jest.fn((_objective: string) => operation);
  const activation = createActivation("Goal that must survive", { close, submit });
  const hook = renderHook(useActivation, { initialProps: activation });

  await act(async () => {
    await hook.result.current.send();
  });
  expect(activation.composerSession.read().plainText).toBe("");
  await act(async () => {
    reject(new Error("Goal admission failed"));
  });

  expect(activation.composerSession.read().plainText).toBe("Goal that must survive");
  expect(close).not.toHaveBeenCalled();
});
function pendingSubmission() {
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<string>((_resolve, onReject) => {
    reject = onReject;
  });
  return { promise, reject };
}

it("delivers a late final transcript with captured attachments and leaves the current composer intact", async () => {
  const first = createActivation("first");
  const second = createActivation("second");
  const capturedAttachment: StoredDraftAttachment = {
    id: "captured-attachment",
    rootId: "attachments",
    path: "voice/context.md",
    name: "context.md",
    kind: "file",
  };
  first.composerSession.updateAttachments([capturedAttachment]);
  const hook = renderHook(useActivation, { initialProps: first });
  const finishVoice = hook.result.current.captureSend();
  first.composerSession.updateAttachments([]);
  hook.rerender(second);
  await act(async () => {
    finishVoice("Final transcript");
  });
  expect(first.onSend).toHaveBeenCalledWith(
    "Final transcript",
    { type: "start" },
    {
      attachments: [
        expect.objectContaining({
          name: "context.md",
          path: "voice/context.md",
        }),
      ],
    },
  );
  expect(second.onSend).not.toHaveBeenCalled();
  expect(first.composerSession.read().plainText).toBe("");
  expect(second.composerSession.read().plainText).toBe("second");
});

it("restores the complete captured voice submission when admission fails", async () => {
  const activation = createActivation("draft before voice");
  const pending = pendingSubmission();
  const capturedAttachment: StoredDraftAttachment = {
    id: "voice-attachment",
    rootId: "attachments",
    path: "voice/reference.md",
    name: "reference.md",
    kind: "file",
  };
  activation.composerSession.updateAttachments([capturedAttachment]);
  activation.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: activation });
  const finishVoice = hook.result.current.captureSend();

  act(() => finishVoice("draft before voice final transcript"));
  expect(activation.composerSession.read().plainText).toBe("");
  expect(activation.composerSession.read().attachments).toEqual([]);

  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(activation.composerSession.read().plainText).toBe(
    "draft before voice final transcript",
  );
  expect(activation.composerSession.read().attachments).toEqual([capturedAttachment]);
});

it("merges a rejected submission with newer typing in the same composer", async () => {
  const activation = createActivation("sent text");
  const pending = pendingSubmission();
  activation.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: activation });
  await act(async () => {
    await hook.result.current.send();
  });
  activation.composerSession.updateText({ markdown: "New typing", plainText: "New typing" });
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(activation.composerSession.read().plainText).toBe("sent text\n\nNew typing");
});

it("restores rejected text to the departed chat without touching the newly selected chat", async () => {
  const first = createActivation("first");
  const second = createActivation("second");
  const pending = pendingSubmission();
  first.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: first });
  await act(async () => {
    await hook.result.current.send();
  });
  first.owner.current = false;
  hook.rerender(second);
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(first.draft.saveDraft).toHaveBeenLastCalledWith("server", "first", "first");
  expect(second.draft.saveDraft).not.toHaveBeenCalled();
  expect(second.composerSession.read().plainText).toBe("second");
});

it("does not let a stale same-scope owner overwrite its replacement after rejection", async () => {
  const first = createActivation("first");
  const pending = pendingSubmission();
  first.onSend.mockImplementation(() => pending.promise);
  const hook = renderHook(useActivation, { initialProps: first });
  await act(async () => {
    await hook.result.current.send();
  });
  first.owner.current = false;
  first.owner.replacement = true;
  await act(async () => {
    pending.reject(new Error("Admission failed"));
  });
  expect(first.composerSession.read().plainText).toBe("");
  expect(first.draft.saveDraft).toHaveBeenCalledTimes(1);
});
