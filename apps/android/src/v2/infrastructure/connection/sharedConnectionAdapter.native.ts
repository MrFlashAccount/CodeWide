import type { SyncV2TransportLease } from "@codewide/sync-client/v2";

import {
  acquireAuthenticatedTransportLease,
  type AuthenticatedDuplexChannel,
  type AuthenticatedRequest,
  type AuthenticatedResponse,
  type AuthenticatedTransportLease,
} from "../../../native/authenticated-transport-lease.native";

export interface SharedConnectionLease {
  lease: AuthenticatedTransportLease;
  syncTransport: SyncV2TransportLease;
}

/** Narrows the shared opaque lease to the argument-free Sync capability. */
export async function acquireSharedConnectionLease(
  savedServerId: string,
): Promise<SharedConnectionLease> {
  const lease = await acquireAuthenticatedTransportLease(savedServerId);
  return {
    lease,
    syncTransport: {
      openSync: (): AuthenticatedDuplexChannel => lease.openDuplex("sync-v2"),
    },
  };
}

export type { AuthenticatedRequest, AuthenticatedResponse };
