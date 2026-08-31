import { MemoryV2OperationStore } from "@codewide/sync-client/v2";

export function createNativeSyncV2OperationStore(): MemoryV2OperationStore {
  // Browser development intentionally has no durable native SQLite journal.
  return new MemoryV2OperationStore();
}
