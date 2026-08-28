import { MemoryV2SavedServerDeletionStore } from "@codewide/sync-client";

export function createNativeSyncV2SavedServerDeletionStore(): MemoryV2SavedServerDeletionStore {
  return new MemoryV2SavedServerDeletionStore();
}
