import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { useComposerGoalMode } from "../src/features/composer/composerGoalMode";
import { createComposerGoalSubmission } from "../src/features/composer/composerGoalSubmission";
import { useComposerDraftCommands, useComposerDraftState } from "../src/features/composer/draft";
import { useComposerSubmission } from "../src/features/composer/submission";
import type { ThreadUiStateRead } from "../src/data/use-thread-ui-state";
import type { ThreadGoalInput } from "../src/data/workspace-resource-database";
import { getAppDialogRequest } from "./mocks/AppDialog";

const goal: ThreadGoal = {
  createdAt: 1, objective: "Verify the release", status: "blocked", threadId: "thread",
  timeUsedSeconds: 90, tokenBudget: 20000, tokensUsed: 1000, updatedAt: 2,
};
const state: ThreadUiStateRead = {
  status: "ready",
  value: {
    attachments: [{ id: "attachment", kind: "file", name: "notes.md", path: "notes.md", rootId: "attachments" }],
    connectionId: "server", draftText: "My unfinished message", id: "thread",
    preferences: null, scrollOffset: null, threadId: "thread", updatedAt: 1,
  },
};

function fixture(scope = "thread") {
  return {
    scope,
    setGoal: jest.fn(async (input: ThreadGoalInput) => ({ ...goal, ...input })),
    onSend: jest.fn(async () => "command"),
    saveDraft: jest.fn(async () => undefined),
    current: true,
  };
}

function useEditing(props: ReturnType<typeof fixture>) {
  const mode = useComposerGoalMode(props.scope);
  const draft = useComposerDraftState(props.scope, state, null, mode.editingGoal);
  const commands = useComposerDraftCommands({
    composerSession: draft.composerSession, draftConnectionId: "server", draftThreadId: props.scope,
    editingGoal: mode.editingGoal, queuedComposerEdit: null, saveDraft: props.saveDraft,
    saveDraftAttachments: undefined,
  });
  const submission = useComposerSubmission({
    composerScope: props.scope, composerUploadScope: draft.composerUploadScope,
    composerSession: draft.composerSession, composerInputRef: draft.composerInputRef,
    captureDraftMutations: commands.captureDraftMutations,
    captureControlsResource: () => () => null, capturePreferenceUpdate: () => () => undefined,
    clearContentReviewAttachmentId: () => undefined, contentReviewAttachmentId: null,
    conversationOwner: { isCurrent: () => props.current, hasReplacement: () => false },
    currentTurnId: null, draftConnectionId: "server", draftThreadId: props.scope,
    goalSubmission: createComposerGoalSubmission(mode, goal, props.setGoal),
    onListQueue: undefined, onSend: props.onSend, pastedAttachmentPendingRef: { current: false },
    queuedComposerEdit: null, saveDraft: props.saveDraft, saveDraftAttachments: undefined,
    selectedEffort: null, selectedModel: null, selectedPermissions: null, selectedPersonality: null,
    selectedServiceTier: undefined, threadLifecycleActive: false,
  });
  return { ...mode, ...draft, ...commands, ...submission };
}

it("loads the goal into composer, sends an objective-only edit and restores the original draft", async () => {
  const props = fixture();
  const hook = renderHook(useEditing, { initialProps: props });
  act(() => hook.result.current.openGoalEdit(goal));
  expect(hook.result.current.goalAttachmentVisible).toBe(true);
  expect(hook.result.current.draft).toBe(goal.objective);
  expect(hook.result.current.attachments).toEqual([]);
  act(() => hook.result.current.updateDraft("Verify and ship"));
  await act(async () => { await hook.result.current.send(); });
  await waitFor(() => expect(hook.result.current.goalAttachmentVisible).toBe(false));
  expect(props.setGoal).toHaveBeenCalledWith({ objective: "Verify and ship", status: "blocked", tokenBudget: 20000 });
  expect(props.onSend).not.toHaveBeenCalled();
  expect(props.saveDraft).not.toHaveBeenCalled();
  expect(hook.result.current.draft).toBe("My unfinished message");
  expect(hook.result.current.attachments).toBe(state.status === "ready" ? state.value.attachments : null);
});

it("cancelling goal mode restores the message and does not update the goal", () => {
  const props = fixture();
  const hook = renderHook(useEditing, { initialProps: props });
  act(() => hook.result.current.updateDraft("New text not yet persisted"));
  act(() => hook.result.current.openGoalEdit(goal));
  act(() => hook.result.current.updateDraft("An unfinished edit"));
  act(() => hook.result.current.closeGoalAttachment());
  expect(hook.result.current.draft).toBe("New text not yet persisted");
  expect(props.setGoal).not.toHaveBeenCalled();
  expect(props.saveDraft).toHaveBeenCalledTimes(1);
});

it("a rejected edit keeps its text available for retry without modifying the message draft", async () => {
  const props = fixture();
  props.setGoal.mockRejectedValueOnce(new Error("Goal update rejected"));
  const hook = renderHook(useEditing, { initialProps: props });
  act(() => hook.result.current.openGoalEdit(goal));
  act(() => hook.result.current.updateDraft("Retry this objective"));
  await act(async () => { await hook.result.current.send(); });
  await waitFor(() => expect(hook.result.current.draft).toBe("Retry this objective"));
  expect(getAppDialogRequest()).toMatchObject({ title: "Could not update goal", message: "Goal update rejected" });
  expect(hook.result.current.goalAttachmentVisible).toBe(true);
  expect(props.saveDraft).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.send(); });
  await waitFor(() => expect(hook.result.current.draft).toBe("My unfinished message"));
  expect(props.onSend).not.toHaveBeenCalled();
});

it("does not recreate a goal removed while its composer editor was open", async () => {
  const mode = renderHook(() => useComposerGoalMode("removed"));
  act(() => mode.result.current.openGoalEdit(goal));
  const setGoal = jest.fn(async (input: ThreadGoalInput) => ({ ...goal, ...input }));
  const submission = createComposerGoalSubmission(mode.result.current, null, setGoal);
  if (submission === null) throw new Error("Missing edit submission");
  await expect(submission.submit("Do not recreate this")).rejects.toThrow("no longer available");
  expect(setGoal).not.toHaveBeenCalled();
});

it("settlement in the previous chat cannot close the new chat's goal editor", async () => {
  const first = fixture("first");
  const pending = Promise.withResolvers<ThreadGoal>();
  first.setGoal.mockImplementationOnce(() => pending.promise);
  const hook = renderHook(useEditing, { initialProps: first });
  act(() => hook.result.current.openGoalEdit(goal));
  await act(async () => { await hook.result.current.send(); });
  first.current = false;
  const second = fixture("second");
  hook.rerender(second);
  act(() => hook.result.current.openGoalEdit({ ...goal, objective: "Second goal", threadId: "second" }));
  await act(async () => pending.resolve(goal));
  expect(hook.result.current.goalAttachmentVisible).toBe(true);
  expect(hook.result.current.draft).toBe("Second goal");
  expect(second.setGoal).not.toHaveBeenCalled();
});

it("does not discard text typed after Send while the goal update is pending", async () => {
  const props = fixture();
  const pending = Promise.withResolvers<ThreadGoal>();
  props.setGoal.mockImplementationOnce(() => pending.promise);
  const hook = renderHook(useEditing, { initialProps: props });
  act(() => hook.result.current.openGoalEdit(goal));
  await act(async () => { await hook.result.current.send(); });
  act(() => hook.result.current.updateDraft("New typing"));
  await act(async () => pending.resolve(goal));
  expect(hook.result.current.goalAttachmentVisible).toBe(true);
  expect(hook.result.current.draft).toBe("New typing");
});
