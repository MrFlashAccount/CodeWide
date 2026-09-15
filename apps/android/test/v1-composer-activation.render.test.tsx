import { act, renderHook } from "@testing-library/react-native";
import { useComposerDraftCommands } from "../src/features/composer/draft";
import { useComposerSettings } from "../src/features/composer/settings";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../src/data/thread-ui-state-types";

type DraftCapabilities = Parameters<typeof useComposerDraftCommands>[0];
function draftCapabilities(threadId: string): DraftCapabilities {
  return {
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
}

it("retains captured draft mutation ownership while current editor callbacks follow a new chat", () => {
  const first = draftCapabilities("first");
  const second = draftCapabilities("second");
  const hook = renderHook(
    (capabilities: DraftCapabilities) => useComposerDraftCommands(capabilities),
    { initialProps: first },
  );
  let captured = hook.result.current.captureDraftMutations();
  const currentUpdate = hook.result.current.updateDraft;
  act(() => {
    captured = hook.result.current.captureDraftMutations();
  });
  hook.rerender(second);
  expect(hook.result.current.updateDraft).toBe(currentUpdate);
  const attachment: StoredDraftAttachment = {
    id: "attachment",
    rootId: "attachments",
    path: "first/a.txt",
    name: "a.txt",
    kind: "file",
  };
  act(() => {
    captured.updateDraft("Recovered first draft");
    captured.updateAttachments([attachment]);
    currentUpdate("Second draft edited");
  });
  expect(first.saveDraft).toHaveBeenCalledWith("server", "first", "Recovered first draft");
  expect(first.saveDraftAttachments).toHaveBeenCalledWith("server", "first", [attachment]);
  expect(first.latestAttachmentsRef.current.latest[0]).toBe(attachment);
  expect(second.latestAttachmentsRef.current.latest).toEqual([]);
  expect(second.saveDraft).toHaveBeenCalledWith("server", "second", "Second draft edited");
  expect(second.latestDraftRef.current.latest).toBe("Second draft edited");
});

const preferences: StoredComposerPreferences = {
  model: null,
  effort: null,
  personality: null,
  permissions: null,
  skillPaths: [],
  sendMode: "start",
};
type SettingsCapabilities = Parameters<typeof useComposerSettings>[0];
function settingsCapabilities(scope: string): SettingsCapabilities {
  return {
    composerScope: scope,
    newChat: true,
    cwd: "/workspace",
    draftConnectionId: "server",
    draftThreadId: scope,
    workspaceResources: null,
    controlsResourceId: null,
    composerPreferences: preferences,
    latestComposerPreferencesRef: {
      current: { scope, rendered: preferences, latest: preferences },
    },
    conversationOwner: { isCurrent: () => true, hasReplacement: () => false },
    onLoadControls: undefined,
    onUpdateSettings: undefined,
    saveComposerPreferences: jest.fn(async () => undefined),
  };
}
it("restores captured skill preferences to the outgoing draft without replacing current selections", () => {
  const first = settingsCapabilities("first");
  const second = settingsCapabilities("second");
  const hook = renderHook(
    (capabilities: SettingsCapabilities) => useComposerSettings(capabilities),
    { initialProps: first },
  );
  const capture = hook.result.current.capturePreferenceUpdate;
  let restore = capture();
  act(() => {
    restore = capture();
  });
  hook.rerender(second);
  act(() => {
    hook.result.current.updateComposerPreferences((current) => ({
      ...current,
      model: "new-model",
    }));
    restore((current) => ({ ...current, skillPaths: ["/skills/first"] }));
  });
  expect(first.latestComposerPreferencesRef.current.latest.skillPaths).toEqual(["/skills/first"]);
  expect(second.latestComposerPreferencesRef.current.latest.model).toBe("new-model");
  expect(second.latestComposerPreferencesRef.current.latest.skillPaths).toEqual([]);
  expect(first.saveComposerPreferences).toHaveBeenCalledWith(
    "server",
    "first",
    first.latestComposerPreferencesRef.current.latest,
  );
});
