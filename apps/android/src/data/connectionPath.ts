import { unknownRecord } from "./unknownRecord";

/** Android observations, not a claim that the user's server is reachable. */
export type NetworkObservation = {
  readonly epoch: number;
  readonly status:
    | "unknown"
    | "noDefaultNetwork"
    | "unvalidated"
    | "captivePortal"
    | "validated"
    | "blocked";
};

/** Independent facts from the owners of the default route and Companion socket. */
export type ConnectionPath = {
  readonly link:
    | { readonly appServer: "unknown" | "reconnecting" | "live"; readonly status: "connected" }
    | {
        readonly status: "connecting" | "waitingForNetwork" | "backoff" | "authRequired";
      };
  readonly network: NetworkObservation;
};

function networkStatus(value: unknown): NetworkObservation["status"] {
  switch (value) {
    case "unknown":
    case "noDefaultNetwork":
    case "unvalidated":
    case "captivePortal":
    case "validated":
    case "blocked":
      return value;
    default:
      throw new Error("Invalid native network observation");
  }
}

function parseLink(value: Record<string, unknown>): ConnectionPath["link"] {
  switch (value.companion) {
    case "connected":
      if (
        value.appServer === "unknown" ||
        value.appServer === "reconnecting" ||
        value.appServer === "live"
      ) {
        return { appServer: value.appServer, status: "connected" };
      }
      break;
    case "connecting":
    case "waitingForNetwork":
    case "backoff":
    case "authRequired":
      return { status: value.companion };
  }
  throw new Error("Invalid native service observation");
}

/** Validates the additive native envelope; older binaries have no OS evidence. */
export function parseConnectionPath(input: unknown): ConnectionPath | null {
  if (input === undefined) {
    return null;
  }
  const value = unknownRecord(input);
  const network = unknownRecord(value?.network);
  const epoch = network?.epoch;
  if (value === null || !validEpoch(epoch)) {
    throw new Error("Invalid native connection path");
  }
  return {
    link: parseLink(value),
    network: { epoch, status: networkStatus(network?.status) },
  };
}

function validEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
