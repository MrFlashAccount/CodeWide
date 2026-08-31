import { MemoryV2ProjectionStore } from "@codewide/sync-client/v2";

export function createNativeSyncV2ProjectionStore(): MemoryV2ProjectionStore {
  // Browser development intentionally has no durable native SQLite replica.
  return new MemoryV2ProjectionStore();
}
