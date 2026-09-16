import type { SyncServerRequest } from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";
import type { PendingServerRequest } from "./pending-request-types";

/** Stores server requests and arbitrates their single active claimant. */
export type PendingRequestDatabase = {
  claim: (connectionId: string, requestKey: string) => boolean;
  close: () => void;
  collection: Collection<PendingServerRequest, string>;
  release: (connectionId: string, requestKey: string) => void;
  replace: (connectionId: string, requests: SyncServerRequest[]) => void;
};
