import { act, renderHook } from "@testing-library/react-native";

import type { StoredDraftAttachment } from "../src/data/thread-ui-state-types";
import { useQueueEditActions } from "../src/features/composer/queueEdit";
import { composerSessionFixture } from "./composer-session-fixture";

const attachment: StoredDraftAttachment = {
  id: "attachment",
  kind: "image",
  name: "photo.png",
  path: "thread/photo.png",
  rootId: "attachments",
};

it("reads the resident text snapshot before saving an attachment queue edit", async () => {
  const composerSession = composerSessionFixture("");
  composerSession.updateAttachments([attachment]);
  const onEditQueued = jest.fn(async () => undefined);
  const getValue = jest.fn(async () => ({
    markdown: "native caption",
    plainText: "native caption",
  }));
  const hook = renderHook(() =>
    useQueueEditActions({
      closeInlineQueueOverlay: () => undefined,
      composerInputRef: {
        current: {
          focus: () => undefined,
          getValue,
          insertCode: () => undefined,
          insertLinkedText: () => undefined,
          insertText: () => undefined,
          startMention: () => undefined,
          toggleOrderedList: () => undefined,
          toggleUnorderedList: () => undefined,
        },
      },
      composerSession,
      composerUploadScope: "thread:queue-edit:command",
      conversationOwner: { hasReplacement: () => false, isCurrent: () => true },
      draftSelectionRef: { current: { end: 0, start: 0 } },
      onEditQueued,
      onListQueue: undefined,
      queuedComposerEdit: {
        commandId: "command",
        initialAttachments: [attachment],
        initialText: "",
      },
      queuedComposerEditBusy: false,
      setQueuedComposerEdit: () => undefined,
      setQueuedComposerEditBusy: () => undefined,
      setQueuedComposerEditError: () => undefined,
      uploadsBlockSend: false,
      voicePhase: "idle",
    }),
  );

  await act(async () => {
    hook.result.current.saveQueuedComposerEdit();
  });

  expect(getValue).toHaveBeenCalledTimes(1);
  expect(onEditQueued).toHaveBeenCalledWith("command", "native caption", [attachment]);
});
