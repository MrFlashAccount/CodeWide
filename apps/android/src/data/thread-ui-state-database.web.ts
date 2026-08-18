import type { ThreadUiStateDatabase } from "./thread-ui-state-database.native";

export type { ThreadUiStateDatabase } from "./thread-ui-state-database.native";

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  return {
    collection: null as never,
    get() { return null; },
    async seedLegacy(_connectionId, _threadId, state) {
      return {
        id: "",
        connectionId: "",
        threadId: "",
        ...state,
        migratedFromLegacy: true,
        updatedAt: Date.now(),
      };
    },
    async saveDraft() {},
    async saveAttachments() {},
    async saveScrollOffset() {},
    async savePreferences() {},
    async deleteConnection() {},
    close() {},
  };
}
