import { MemoryV2SavedServerDeletionStore } from "@codewide/sync-client/v2";

export function createNativeSyncV2SavedServerDeletionStore(): MemoryV2SavedServerDeletionStore {
  // Browser development intentionally has no durable native deletion journal.
  return new MemoryV2SavedServerDeletionStore();
}
