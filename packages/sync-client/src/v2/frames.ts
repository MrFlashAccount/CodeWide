export type { V2ClientFrame, V2OpenIntent, V2ServerFrame } from "./contract.generated";

import type { V2ServerFrame } from "./contract.generated";

export type V2SnapshotFrame = Extract<V2ServerFrame, { type: "snapshot" }>;
export type V2CommandTerminalFrame = Extract<V2ServerFrame, {
  type: "commandCompleted" | "commandFailed" | "commandIndeterminate" | "commandRejected" | "commandExpired";
}>;
