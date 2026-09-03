import type { ThreadPinRecord, ThreadPinStore } from "../../application/ports/threadPinStore";

export function createThreadPinStore(): ThreadPinStore {
  const records = new Map<string, ThreadPinRecord>();
  return {
    async deleteSavedServer(savedServerId) {
      for (const [key, record] of records) {
        if (record.savedServerId === savedServerId) records.delete(key);
      }
    },
    async list() {
      const result: ThreadPinRecord[] = [];
      for (const record of records.values()) result.push(record);
      return result;
    },
    async setPinned(savedServerId, threadId, pinned) {
      const key = JSON.stringify([savedServerId, threadId]);
      if (pinned) records.set(key, { savedServerId, threadId });
      else records.delete(key);
    },
  };
}
