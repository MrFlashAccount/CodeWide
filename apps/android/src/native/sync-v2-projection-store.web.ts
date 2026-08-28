import { MemoryV2ProjectionStore } from "@codewide/sync-client";

export function createNativeSyncV2ProjectionStore(): MemoryV2ProjectionStore {
  return new MemoryV2ProjectionStore();
}
