import type { StoredConnection } from "../data/connection-profile-types";
import type { CompanionConnectionTransport } from "./companionTransportContract";
import { urlTransport } from "./urlTransport";

/** Browsers reach Companion directly at the HTTP origin of its sync endpoint. */
export function companionConnectionTransport(
  connection: Pick<StoredConnection, "endpoint" | "id">,
): CompanionConnectionTransport {
  const url = new URL(connection.endpoint);
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  return { baseUrl: `${protocol}//${url.host}`, transport: urlTransport };
}
