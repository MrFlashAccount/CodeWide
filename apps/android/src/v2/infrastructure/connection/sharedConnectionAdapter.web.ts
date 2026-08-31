import type { SyncV2TransportLease } from "@codewide/sync-client/v2";

import {
  acquireAuthenticatedTransportLease,
  type AuthenticatedTransportLease,
} from "../../../native/authenticated-transport-lease.web";

export type SharedConnectionLease = {
  lease: AuthenticatedTransportLease;
  syncTransport: SyncV2TransportLease;
};

export async function acquireSharedConnectionLease(
  savedServerId: string,
): Promise<SharedConnectionLease> {
  const lease = await acquireAuthenticatedTransportLease(savedServerId);
  return { lease, syncTransport: { openSync: () => lease.openDuplex("sync-v2") } };
}
