export type {
  AuthenticatedDuplexChannel,
  AuthenticatedRequest,
  AuthenticatedResponse,
  AuthenticatedTransportLease,
} from "./authenticated-transport-lease.contract";

import type { AuthenticatedTransportLease } from "./authenticated-transport-lease.contract";

/** Platform implementations acquire the one service-owned connection authority by SavedServerId. */
export async function acquireAuthenticatedTransportLease(_savedServerId: string): Promise<AuthenticatedTransportLease> {
  throw new Error("Authenticated transport leases require a platform implementation");
}
