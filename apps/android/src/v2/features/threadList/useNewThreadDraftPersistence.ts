import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type { ComposerAttachmentDraftScope } from "../../application/composer/composerAttachmentController";
import type { PersistedNewThreadDraft } from "../../application/ports/composerDraftStore";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";

interface NewThreadDraftPersistence {
  attachmentDraft(selection: PersistedNewThreadDraft): ComposerAttachmentDraft;
  clear(selection: PersistedNewThreadDraft): void;
  message: string;
  persist(selection: PersistedNewThreadDraft): void;
  replaceMessage(selection: PersistedNewThreadDraft, value: string): void;
  restored: PersistedNewThreadDraft | null;
}

/** Owns durable New Thread state inside the per-server composer draft namespace. */
export function useNewThreadDraftPersistence(
  savedServerId: SavedServerId,
): NewThreadDraftPersistence {
  const runtime = useV2Runtime();
  const draftId = `new-thread:${savedServerId}`;
  const [resource] = useState(() =>
    runtime.composerAttachments.state(baseScope(draftId, savedServerId)),
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const attachmentDraft = (selection: PersistedNewThreadDraft): ComposerAttachmentDraft =>
    runtime.composerAttachments.draft(draftScope(draftId, savedServerId, selection));
  const persist = useEvent((selection: PersistedNewThreadDraft): void => {
    runtime.composerAttachments.setNewThread(
      draftScope(draftId, savedServerId, selection),
      selection,
    );
  });
  const replaceMessage = useEvent((selection: PersistedNewThreadDraft, value: string): void => {
    const scope = draftScope(draftId, savedServerId, selection);
    runtime.composerAttachments.setNewThread(scope, selection);
    runtime.composerAttachments.setText(scope, value);
  });
  const clear = useEvent((selection: PersistedNewThreadDraft): void => {
    const scope = draftScope(draftId, savedServerId, selection);
    runtime.composerAttachments.draft(scope).commit();
    runtime.composerAttachments.setText(scope, "");
    runtime.composerAttachments.setNewThread(scope, null);
  });
  return {
    attachmentDraft,
    clear,
    message: snapshot.value.text,
    persist,
    replaceMessage,
    restored: snapshot.value.newThread,
  };
}

function baseScope(draftId: string, savedServerId: SavedServerId): ComposerAttachmentDraftScope {
  return {
    draftId,
    savedServerId,
    target: { threadId: null, workspace: null },
  };
}

function draftScope(
  draftId: string,
  savedServerId: SavedServerId,
  selection: PersistedNewThreadDraft,
): ComposerAttachmentDraftScope {
  return {
    draftId,
    newThread: selection,
    savedServerId,
    target: { threadId: null, workspace: selection.workspace },
  };
}
