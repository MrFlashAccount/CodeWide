import type { SyncServerRequest } from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";
import type { PendingServerRequest } from "./pending-request-types";

export type PendingRequestDatabase = {
  collection: Collection<PendingServerRequest, string>;
  replace(connectionId: string, requests: SyncServerRequest[]): void;
  claim(connectionId: string, requestKey: string): boolean;
  release(connectionId: string, requestKey: string): void;
  close(): void;
};
