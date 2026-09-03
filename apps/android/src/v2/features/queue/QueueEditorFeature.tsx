import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import { threadId, type SavedServerId } from "../../domain/ids";
import {
  QueueEditorView,
  type QueueEditorViewProps,
} from "../../presentation/queue/QueueEditorView";
import type {
  QueueEditorAttachmentModel,
  QueueEditorSubmission,
  QueueRowActions,
  QueueRowModel,
} from "../../presentation/queue/queueTypes";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface QueueEditorFeatureProps {
  actions: QueueRowActions;
  disabled: boolean;
  item: QueueRowModel;
  onCancel(): void;
  savedServerId: SavedServerId;
  threadId: string;
}

/** Stages queue-edit attachments through the same device-bound transport as the composer. */
export function QueueEditorFeature(props: QueueEditorFeatureProps): React.JSX.Element {
  const { actions, disabled, item, onCancel, savedServerId, threadId: rawThreadId } = props;
  const runtime = useV2Runtime();
  const ownerThreadId = threadId(rawThreadId);
  const [retainedAttachments, setRetainedAttachments] = useState(item.attachments);
  const draftScope = {
    draftId: `queue:${rawThreadId}:${item.id}`,
    savedServerId,
    target: { threadId: ownerThreadId, workspace: null },
  };
  const [localStateResource] = useState(() => runtime.composerAttachments.state(draftScope));
  const localState = useSyncExternalStore(
    localStateResource.subscribe,
    localStateResource.snapshot,
    localStateResource.snapshot,
  );
  const draft = runtime.composerAttachments.draft(draftScope);
  const snapshot = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot);
  const ensureTextIsDurable = useEvent(() => {
    if (!localState.value.persisted) {
      runtime.composerAttachments.setText(draftScope, item.editableText);
    }
  });
  const addFile = useEvent(async () => {
    ensureTextIsDurable();
    await draft.pickFile();
  });
  const addImage = useEvent(async () => {
    ensureTextIsDurable();
    await draft.pickImage();
  });
  const cancel = useEvent(async () => {
    draft.clear();
    await runtime.composerAttachments.discard(draftScope);
    onCancel();
  });
  const removeAttachment = useEvent((attachment: QueueEditorAttachmentModel) => {
    ensureTextIsDurable();
    if (attachment.source === "draft") draft.remove(attachment.id);
    else setRetainedAttachments((current) => current.filter((entry) => entry.id !== attachment.id));
  });
  const retryAttachment = useEvent(async (attachment: QueueEditorAttachmentModel) => {
    if (attachment.source !== "draft") return;
    await draft.retry(attachment.id);
  });
  const save = useEvent(async (submission: QueueEditorSubmission) => {
    const staged = await draft.prepareInput("", { threadId: ownerThreadId, workspace: null });
    const attachmentIds = [...submission.retainedAttachmentIds];
    const knownAttachmentIds = new Set(attachmentIds);
    for (const block of staged) {
      if (block.kind === "attachment" && !knownAttachmentIds.has(block.attachmentId)) {
        attachmentIds.push(block.attachmentId);
        knownAttachmentIds.add(block.attachmentId);
      }
    }
    await actions.onEdit(item.id, submission.text, attachmentIds);
    draft.commit();
    await runtime.composerAttachments.discard(draftScope);
    onCancel();
  });
  const changeText = useEvent((text: string) => {
    runtime.composerAttachments.setText(draftScope, text);
  });
  const renderTextInput: QueueEditorViewProps["renderTextInput"] = (inputProps) => (
    <VoiceTextInput
      {...inputProps}
      audience={savedServerId}
      scope={{ id: `queue:${rawThreadId}:${item.id}`, kind: "composer" }}
      thread={qualifiedThread(savedServerId, ownerThreadId)}
      value={typeof inputProps.value === "string" ? inputProps.value : ""}
    />
  );
  const attachments: QueueEditorAttachmentModel[] = retainedAttachments.map((attachment) => ({
    error: null,
    id: attachment.id,
    label: attachment.name,
    source: "retained",
    state: "ready",
  }));
  for (const entry of snapshot.value.items) {
    attachments.push({
      error: entry.error,
      id: entry.id,
      label: entry.name,
      source: "draft",
      state: entry.state === "selected" ? "ready" : entry.state,
    });
  }
  return (
    <QueueEditorView
      attachments={attachments}
      disabled={disabled}
      initialText={item.editableText}
      onAddFile={addFile}
      onAddImage={addImage}
      onCancel={cancel}
      onRemoveAttachment={removeAttachment}
      onRetryAttachment={retryAttachment}
      onSave={save}
      onTextChange={changeText}
      // WHY: This is a render prop; repository callback policy delegates its identity to React Compiler instead of stabilizing it with useEvent/useCallback.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      renderTextInput={renderTextInput}
      text={localState.value.persisted ? localState.value.text : item.editableText}
    />
  );
}
