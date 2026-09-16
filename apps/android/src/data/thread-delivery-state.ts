import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport";

/**
 * Delivery checkpoints owned by the Android projection.
 *
 * `accepted` and `delivered` are retained only to read rows written by older
 * OTA bundles. Both used to mean that the native ledger had durably handed the
 * command to Companion, so neither may be presented as an App Server receipt.
 */
export type PendingDeliveryState =
  | "queued"
  | "sending"
  | "companionAccepted"
  | "appServerAccepted"
  | "uncertain"
  | "failed"
  | "accepted"
  | "delivered";

export type VisiblePendingDeliveryState = Exclude<PendingDeliveryState, "accepted" | "delivered">;

export function normalizePendingDeliveryState(
  state: PendingDeliveryState,
): VisiblePendingDeliveryState {
  return state === "accepted" || state === "delivered" ? "companionAccepted" : state;
}

export function pendingDeliveryStateFromNative(
  state: NativeCommandDelivery["state"],
): VisiblePendingDeliveryState {
  return state === "accepted" || state === "delivered" ? "companionAccepted" : state;
}

export function pendingDeliveryStateFromCompanion(
  state: "queued" | "uncertain" | "failed" | "delivered",
): VisiblePendingDeliveryState {
  switch (state) {
    case "queued":
      return "companionAccepted";
    case "uncertain":
      return "uncertain";
    case "failed":
      return "failed";
    case "delivered":
      return "appServerAccepted";
    default:
      throw new Error("Unsupported delivery state");
  }
}

export function deliveryProgressRank(state: PendingDeliveryState): number {
  const normalized = normalizePendingDeliveryState(state);
  switch (normalized) {
    case "queued":
      return 0;
    case "sending":
      return 1;
    case "companionAccepted":
      return 2;
    case "uncertain":
      return 3;
    case "failed":
      return 4;
    case "appServerAccepted":
      return 5;
    default:
      throw new Error("Unsupported delivery progress state");
  }
}

export type QueuedPrompt = {
  attachments: RemoteFileAttachment[];
  commandId: string;
  createdAt: number;
  lastError: string | null;
  state: "queued" | "uncertain" | "failed";
  text: string;
};

import type { ThreadSettings } from "./turn-controls-types";
export type SendMode =
  | { type: "start" }
  | { type: "queue" }
  | { expectedTurnId: string; type: "steer" };
export type TurnSendOptions = ThreadSettings & {
  attachments?: RemoteFileAttachment[];
  skills?: Array<{ name: string; path: string }>;
  workspaceRequestId?: string;
};
