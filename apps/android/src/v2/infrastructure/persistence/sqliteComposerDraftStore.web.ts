import type {
  ComposerDraftStore,
  PersistedComposerDraft,
} from "../../application/ports/composerDraftStore";

export function createComposerDraftStore(): ComposerDraftStore {
  const drafts = new Map<string, PersistedComposerDraft>();
  return {
    async delete(savedServerId, draftId) {
      drafts.delete(key(savedServerId, draftId));
    },
    async deleteSavedServer(savedServerId) {
      for (const [draftKey, record] of drafts) {
        if (record.savedServerId === savedServerId) drafts.delete(draftKey);
      }
    },
    async load() {
      return [...drafts.values()];
    },
    async upsert(record) {
      drafts.set(key(record.savedServerId, record.draftId), record);
    },
  };
}

function key(savedServerId: string, draftId: string): string {
  return `${savedServerId}\u0000${draftId}`;
}
