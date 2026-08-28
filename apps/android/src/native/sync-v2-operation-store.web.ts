import { MemoryV2OperationStore } from "@codewide/sync-client";

export function createNativeSyncV2OperationStore(): MemoryV2OperationStore {
  return new MemoryV2OperationStore();
}
