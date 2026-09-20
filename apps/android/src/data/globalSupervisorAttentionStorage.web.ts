import type {
  GlobalSupervisorAttentionStorage,
  GlobalSupervisorAttentionStoredRow,
} from "./globalSupervisorAttentionStorage.types";

export function createGlobalSupervisorAttentionStorage(): GlobalSupervisorAttentionStorage {
  const rows = new Map<string, GlobalSupervisorAttentionStoredRow>();
  return {
    close() {
      rows.clear();
    },
    async commit(changes) {
      for (const change of changes) {
        if (change.type === "delete") {
          rows.delete(change.id);
        } else {
          rows.set(change.row.id, change.row);
        }
      }
      await Promise.resolve();
    },
    ready: Promise.resolve(),
    rows: () => [...rows.values()],
  };
}
