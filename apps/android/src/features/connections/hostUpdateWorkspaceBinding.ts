import { randomUUID } from "expo-crypto";

import type { StoredConnection } from "../../data/connection-profile-types";
import type { createWorkspaceSession } from "../../data/workspace-session";
import { nativeCompanionHttpOrigin } from "../../native/native-transport";
import { createHostUpdateResource } from "./hostUpdateResource";
import type { HostUpdateResource } from "./hostUpdateResourceState";
import { createHostUpdateTransport } from "./hostUpdateTransport";

/** Binds the Connections resource to the existing pinned HTTP/session authorities. */
export function createConnectionHostUpdateResource({
  currentConnections,
  scopedHttpAuthorization,
}: {
  readonly currentConnections: () => StoredConnection[];
  readonly scopedHttpAuthorization: ReturnType<
    typeof createWorkspaceSession
  >["scopedHttpAuthorization"];
}): HostUpdateResource {
  return createHostUpdateResource({
    createIdempotencyKey: randomUUID,
    transport: createHostUpdateTransport({
      currentConnections,
      nativeCompanionHttpOrigin,
      scopedHttpAuthorization,
    }),
  });
}
