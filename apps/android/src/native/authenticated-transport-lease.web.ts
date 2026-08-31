export type {
  AuthenticatedDuplexChannel,
  AuthenticatedRequest,
  AuthenticatedResponse,
  AuthenticatedTransportLease,
} from "./authenticated-transport-lease.contract";

import type { AuthenticatedTransportLease } from "./authenticated-transport-lease.contract";

export async function acquireAuthenticatedTransportLease(_savedServerId: string): Promise<AuthenticatedTransportLease> {
  throw new Error("The web host did not provide an authenticated transport lease");
}
