import { colors } from "../../theme";

export type PresentedConnectionState =
  | "accessRequired"
  | "connected"
  | "connecting"
  | "disabled"
  | "error"
  | "offline"
  | "updating";

export function connectionStateColor(state: PresentedConnectionState): string {
  if (state === "connected") return colors.green;
  if (state === "connecting" || state === "updating") return colors.amber;
  if (state === "accessRequired" || state === "error") return colors.red;
  return colors.textDim;
}

export function connectionStateLabel(state: PresentedConnectionState): string {
  if (state === "connected") return "Connected";
  if (state === "connecting") return "Connecting";
  if (state === "updating") return "Updating";
  if (state === "accessRequired") return "Access required";
  if (state === "error") return "Connection error";
  if (state === "offline") return "Offline";
  return "Disabled";
}

export function isActiveConnectionState(state: PresentedConnectionState): boolean {
  return state === "connecting" || state === "updating";
}
