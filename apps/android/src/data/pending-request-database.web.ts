import type { SyncServerRequest } from "@codewide/sync-client";

import type { PendingServerRequest } from "./pending-request-types";

export type PendingRequestDatabase = {
  collection: never;
  replace(connectionId: string, requests: SyncServerRequest[]): void;
  claim(connectionId: string, requestKey: string): boolean;
  release(connectionId: string, requestKey: string): void;
  close(): void;
};

export function createPendingRequestDatabase(): PendingRequestDatabase {
  throw new Error("Pending request database is Android only");
}
